const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const config = require("../config");
const { db } = require("../db");
const { invalidate, invalidateUser } = require("../auth");
const { statsFor } = require("../memberStats");

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

// A UPI ID is handle@bank — e.g. name@okaxis, 9876543210@ybl.
const UPI_PATTERN = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/;

/** The UPI ID and lifetime stats, which are not part of the cached user. */
async function extras(userId) {
  const [{ data, error }, stats] = await Promise.all([
    db.from("profiles").select("upi_id").eq("id", userId).maybeSingle(),
    statsFor([userId]).catch(() => ({})),
  ]);

  return {
    upiId: error ? null : data?.upi_id || null,
    paymentsReady: !error,
    stats: stats[userId] || null,
  };
}

/** GET /api/profile — who the caller is, according to the server. */
router.get("/", async (req, res, next) => {
  try {
    res.json({ user: { ...req.user, ...(await extras(req.user.id)) } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/profile
 *
 * Only ever writes to the caller's own row: the id comes from the
 * verified token, so one user cannot edit another's profile.
 */
router.patch("/", async (req, res, next) => {
  try {
    const { name, pickupPoint, vehicle, capacity, vehicleNumber, phone, course, upiId } =
      req.body || {};

    const patch = {};

    // Where riders pay this driver. Empty clears it.
    if (upiId != null) {
      const upi = String(upiId).trim();
      if (upi && !UPI_PATTERN.test(upi)) {
        return res.status(400).json({ error: "That UPI ID doesn't look right. It should look like name@bank, e.g. 9876543210@ybl." });
      }
      patch.upi_id = upi || null;
    }

    if (name != null) {
      if (!String(name).trim()) {
        return res.status(400).json({ error: "Name cannot be empty." });
      }
      patch.name = String(name).trim();
    }

    if (pickupPoint != null) patch.pickup_point = String(pickupPoint).trim();
    if (course != null) patch.course = String(course).trim().slice(0, 80);

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

    // Backfills the address for anyone whose profile was created before
    // the column existed. From the token, so it is always theirs.
    if (req.user.email) patch.email = req.user.email;

    // Update the caller's row when it exists. `maybeSingle()` is deliberate:
    // older accounts can exist in Supabase Auth without a matching profiles
    // row (for example, if signup was interrupted after Auth succeeded).
    // In that case we create the profile instead of turning a normal setup
    // action into PGRST116 / "0 rows".
    let { data, error } = await db
      .from("profiles")
      .update(patch)
      .eq("id", req.user.id)
      .select()
      .maybeSingle();

    if (!error && !data) {
      const created = await db
        .from("profiles")
        .upsert(
          {
            id: req.user.id,
            name: req.user.name || req.user.email?.split("@")[0] || "Rider",
            role: req.user.role === "faculty" ? "faculty" : "student",
            email: req.user.email || null,
            ...patch,
          },
          { onConflict: "id" }
        )
        .select()
        .single();

      data = created.data;
      error = created.error;
    }

    // A column the code writes but the database has not got yet. Saying
    // so beats "something went wrong": the fix is a migration, and only
    // the person running the project can apply it.
    if (error?.code === "PGRST204") {
      console.error("Missing column — run the migrations in db/:", error.message);

      const missing = /column ['"]([^'"]+)['"]/i.exec(error.message || "")?.[1];
      const migration = missing === "vehicle_number" ? "003_vehicle_number.sql"
        : missing === "phone" ? "004_phone_number.sql"
        : missing === "email" ? "006_profile_email.sql"
        : missing === "course" ? "013_campus_social.sql"
        : missing === "upi_id" ? "014_payments_stats_reminders.sql"
        : "the database migrations in db/";

      return res.status(503).json({
        error: `The profile database is missing ${missing ? `the ${missing} field` : "a required field"}. Run ${migration} in the Supabase SQL editor.`,
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
        course: data.course || null,
        ...(await extras(req.user.id)),
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

          // Taken from the verified token, never from the request body,
          // so nobody can aim their notifications at another address.
          // Notifications need to reach the *other* person, and
          // auth.users is not readable without the service-role key.
          email: req.user.email ?? null,
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

const LIVE_TRIP = ["to_pickup", "arrived", "started"];

/**
 * DELETE /api/profile
 *
 * Deletes the caller's own account: their rides, their seat requests,
 * their profile and finally the Supabase Auth user. The id comes from the
 * verified token, and the password is checked again here, so a stolen or
 * forgotten-open session is not enough to wipe somebody out.
 *
 * Students and faculty only. Administrators are managed from the admin
 * side and are refused here.
 */
router.delete("/", async (req, res, next) => {
  try {
    const password = String(req.body?.password || "");
    const userId = req.user.id;

    if (req.user.isAdmin || req.user.isPortalAdmin) {
      return res.status(403).json({
        error: "Administrator accounts cannot be deleted from here.",
      });
    }

    if (!password) {
      return res.status(400).json({ error: "Enter your password to confirm." });
    }

    // A throwaway client, so this sign-in never touches the shared one
    // the server uses to check tokens.
    const verifier = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: check, error: passwordError } =
      await verifier.auth.signInWithPassword({ email: req.user.email, password });

    if (passwordError || check?.user?.id !== userId) {
      return res.status(400).json({ error: "That password is not right." });
    }

    await verifier.auth.signOut().catch(() => {});

    // Not in the middle of a trip, on either side of it. Somebody waiting
    // at a kerb should not see their driver vanish.
    const { data: driving, error: drivingError } = await db
      .from("rides")
      .select("id, trip_status")
      .eq("driver_id", userId);

    if (drivingError) throw drivingError;

    const { data: riding, error: ridingError } = await db
      .from("trip_requests")
      .select("ride_id")
      .eq("rider_id", userId)
      .eq("status", "accepted");

    if (ridingError) throw ridingError;

    const ridingIds = (riding || []).map((q) => q.ride_id).filter(Boolean);
    let ridingLive = false;

    if (ridingIds.length) {
      const { data: rides, error } = await db
        .from("rides")
        .select("trip_status")
        .in("id", ridingIds);

      if (error) throw error;
      ridingLive = (rides || []).some((r) => LIVE_TRIP.includes(r.trip_status));
    }

    const midTrip =
      ridingLive || (driving || []).some((r) => LIVE_TRIP.includes(r.trip_status));

    if (midTrip) {
      return res.status(409).json({
        error: "You have a trip in progress. Finish it before deleting your account.",
      });
    }

    // Removed explicitly rather than relying on cascades, because whether
    // rides and requests cascade depends on how the database was created.
    // Messages, ratings, reports filed and wall posts cascade from the
    // profile in the migrations.
    const rideIds = (driving || []).map((r) => r.id);

    if (rideIds.length) {
      const { error } = await db.from("trip_requests").delete().in("ride_id", rideIds);
      if (error) throw error;
    }

    {
      const { error } = await db.from("trip_requests").delete().eq("rider_id", userId);
      if (error) throw error;
    }

    if (rideIds.length) {
      const { error } = await db.from("rides").delete().in("id", rideIds);
      if (error) throw error;
    }

    {
      const { error } = await db.from("profiles").delete().eq("id", userId);
      if (error) throw error;
    }

    // Last, so a failure above leaves a working account rather than a
    // sign-in with nothing behind it.
    const { error: authError } = await db.auth.admin.deleteUser(userId);

    if (authError) {
      console.error("Could not delete auth user", userId, authError.message);
      return res.status(502).json({
        error: "Your data was removed, but the sign-in could not be deleted. Try again.",
      });
    }

    invalidateUser(userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
