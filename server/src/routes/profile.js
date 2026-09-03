const express = require("express");
const { db } = require("../db");
const { invalidate } = require("../auth");

const router = express.Router();

const VEHICLES = ["none", "bike", "scooty", "car"];

/**
 * Number plates vary by state and people write them a dozen ways. This
 * normalises the spacing and case so two spellings of one plate match,
 * without pretending to know every country's format.
 */
function normalisePlate(raw) {
  return String(raw).trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Phone numbers are written a dozen ways too. Keep the punctuation people
 * expect to see, drop the noise, and do not pretend to validate every
 * country's numbering plan.
 */
function normalisePhone(raw) {
  return String(raw).trim().replace(/[^\d+]/g, "");
}

function phoneProblem(phone) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length < 7) return "That phone number looks too short.";
  if (digits.length > 15) return "That phone number looks too long.";

  if (!/^\+?\d+$/.test(phone)) {
    return "A phone number can only contain digits, and may start with +.";
  }

  return null;
}

function plateProblem(plate) {
  if (plate.length < 4) return "That vehicle number looks too short.";
  if (plate.length > 16) return "That vehicle number looks too long.";

  if (!/^[A-Z0-9][A-Z0-9 -]*[A-Z0-9]$/.test(plate)) {
    return "A vehicle number can only contain letters, digits, spaces and hyphens.";
  }

  return null;
}

/** GET /api/profile — who the caller is, according to the server. */
router.get("/", (req, res) => {
  res.json({ user: req.user });
});

/**
 * PATCH /api/profile
 *
 * Only ever writes to the caller's own row: the id comes from the
 * verified token, so one user cannot edit another's profile.
 */
router.patch("/", async (req, res, next) => {
  try {
    const { name, pickupPoint, vehicle, capacity, vehicleNumber, phone } =
      req.body || {};

    const patch = {};

    if (name != null) {
      if (!String(name).trim()) {
        return res.status(400).json({ error: "Name cannot be empty." });
      }
      patch.name = String(name).trim();
    }

    if (pickupPoint != null) patch.pickup_point = String(pickupPoint).trim();

    if (vehicle != null) {
      if (!VEHICLES.includes(vehicle)) {
        return res.status(400).json({ error: `vehicle must be one of ${VEHICLES.join(", ")}.` });
      }
      patch.vehicle = vehicle;
    }

    if (capacity != null) {
      const seats = Number(capacity);

      if (!Number.isFinite(seats) || seats < 0 || seats > 6) {
        return res.status(400).json({ error: "Capacity must be between 0 and 6." });
      }

      patch.capacity = seats;
    }

    if (phone != null) {
      const digits = normalisePhone(phone);

      if (digits) {
        const problem = phoneProblem(digits);
        if (problem) return res.status(400).json({ error: problem });
      }

      patch.phone = digits || null;
    }

    if (vehicleNumber != null) {
      const plate = normalisePlate(vehicleNumber);

      if (plate) {
        const problem = plateProblem(plate);
        if (problem) return res.status(400).json({ error: problem });
      }

      patch.vehicle_number = plate || null;
    }

    // Someone who drives has to say what they drive. The rider is going to
    // be standing at a kerb looking for it.
    const endsUpDriving = patch.vehicle
      ? patch.vehicle !== "none"
      : req.user.vehicle && req.user.vehicle !== "none";

    const endsUpWithPlate =
      patch.vehicle_number !== undefined ? patch.vehicle_number : req.user.vehicleNumber;

    if (endsUpDriving && !endsUpWithPlate) {
      return res
        .status(400)
        .json({ error: "Add your vehicle number so riders can spot you." });
    }

    // Giving up a vehicle gives up its plate and its seats with it.
    if (patch.vehicle === "none") {
      patch.vehicle_number = null;
      patch.capacity = 0;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    const { data, error } = await db
      .from("profiles")
      .update(patch)
      .eq("id", req.user.id)
      .select()
      .single();

    // A column the code writes but the database has not got yet. Saying
    // so beats "something went wrong": the fix is a migration, and only
    // the person running the project can apply it.
    if (error?.code === "PGRST204") {
      console.error("Missing column — run the migrations in db/:", error.message);

      return res.status(503).json({
        error:
          "This profile field is not set up in the database yet. Run db/003_vehicle_number.sql in the Supabase SQL editor.",
      });
    }

    if (error) throw error;

    // The cached copy of this user is now stale.
    const header = req.get("authorization") || "";
    invalidate(header.startsWith("Bearer ") ? header.slice(7).trim() : null);

    res.json({
      user: {
        ...req.user,
        name: data.name,
        pickupPoint: data.pickup_point,
        vehicle: data.vehicle,
        capacity: data.capacity,
        vehicleNumber: data.vehicle_number,
        phone: data.phone,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/profile
 *
 * Creates the profile row straight after sign-up. Idempotent, so a
 * retried registration does not fail.
 */
router.post("/", async (req, res, next) => {
  try {
    const { name, role } = req.body || {};

    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "Name is required." });
    }

    const { data, error } = await db
      .from("profiles")
      .upsert(
        {
          id: req.user.id,
          name: String(name).trim(),
          role: role === "faculty" ? "faculty" : "student",
        },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (error) throw error;

    // requireAuth may have cached this user before the profile existed,
    // in which case the cached name is a placeholder from their email.
    const header = req.get("authorization") || "";
    invalidate(header.startsWith("Bearer ") ? header.slice(7).trim() : null);

    res.status(201).json({ profile: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
