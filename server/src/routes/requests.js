const express = require("express");
const { db } = require("../db");

const router = express.Router();

const STATUSES = ["pending", "accepted", "declined"];

/**
 * GET /api/requests/mine
 *
 * The rider's own trips: every request they have sent, joined to the
 * ride and the driver.
 */
router.get("/mine", async (req, res, next) => {
  try {
    const { data: reqs, error } = await db
      .from("trip_requests")
      .select("*")
      .eq("rider_id", req.user.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!reqs?.length) return res.json({ trips: [] });

    const rideIds = [...new Set(reqs.map((r) => r.ride_id))];

    const { data: rides } = await db.from("rides").select("*").in("id", rideIds);

    const driverIds = [...new Set((rides || []).map((r) => r.driver_id))];

    const { data: profiles } = await db
      .from("profiles")
      .select("id, name, role, vehicle, vehicle_number, phone")
      .in("id", driverIds);

    const trips = reqs.map((r) => {
      const ride = rides?.find((x) => x.id === r.ride_id);
      const driver = profiles?.find((p) => p.id === ride?.driver_id);

      return {
        tripId: r.id,
        status: r.status,
        rideId: r.ride_id,
        requestedAt: r.created_at,

        pickup: ride?.pickup,
        dropoff: ride?.dropoff,
        date: ride?.date,
        time: ride?.time,
        vehicle: ride?.vehicle,

        routeGeometry: ride?.route_geometry,
        distanceMeters: ride?.distance_meters,
        durationSeconds: ride?.duration_seconds,

        // How far along the trip is, so an arrival is visible without
        // sitting on the live map.
        tripStatus: ride?.trip_status || "scheduled",

        // Needed to navigate to the meeting point once accepted.
        pickupLat: ride?.pickup_lat,
        pickupLng: ride?.pickup_lng,
        dropoffLat: ride?.dropoff_lat,
        dropoffLng: ride?.dropoff_lng,

        person: driver?.name || ride?.driver_name || "Driver",
        role: driver?.role || "Student",
        vehicleNumber: driver?.vehicle_number || null,

        // Released only once this rider has actually been accepted.
        phone: r.status === "accepted" ? driver?.phone || null : null,
      };
    });

    res.json({ trips });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/requests/incoming
 *
 * Requests other people have made on rides this user is driving.
 */
router.get("/incoming", async (req, res, next) => {
  try {
    const { data: myRides, error } = await db
      .from("rides")
      .select("id, pickup, dropoff, date, time, seats")
      .eq("driver_id", req.user.id);

    if (error) throw error;

    if (!myRides?.length) return res.json({ requests: [] });

    // Oldest first. Whoever asked first is answered first, and the order
    // the driver sees is the order the requests actually arrived in —
    // not the order the database happened to return them.
    const { data: reqs } = await db
      .from("trip_requests")
      .select("*")
      .in(
        "ride_id",
        myRides.map((r) => r.id)
      )
      .order("created_at", { ascending: true });

    if (!reqs?.length) return res.json({ requests: [] });

    const riderIds = [...new Set(reqs.map((r) => r.rider_id))];

    const { data: profiles } = await db
      .from("profiles")
      .select("id, name, phone")
      .in("id", riderIds);

    // Queue position is per ride: "2nd in line for the 8:30 to campus",
    // not 2nd across everything this driver has posted.
    const seenPerRide = {};
    const acceptedPerRide = {};

    for (const r of reqs) {
      if (r.status === "accepted") {
        acceptedPerRide[r.ride_id] = (acceptedPerRide[r.ride_id] || 0) + 1;
      }
    }

    const requests = reqs.map((r) => {
      const ride = myRides.find((x) => x.id === r.ride_id);
      const rider = profiles?.find((p) => p.id === r.rider_id);

      seenPerRide[r.ride_id] = (seenPerRide[r.ride_id] || 0) + 1;

      const seats = ride?.seats || 1;
      const taken = acceptedPerRide[r.ride_id] || 0;

      return {
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        ride,
        position: seenPerRide[r.ride_id],
        seats,
        seatsLeft: Math.max(0, seats - taken),
        riderName: rider?.name || "Unknown rider",

        // Same rule in the other direction: a driver gets the number only
        // for a rider they have said yes to.
        riderPhone: r.status === "accepted" ? rider?.phone || null : null,
      };
    });

    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/requests
 *
 * Ask for a seat. The rider is taken from the token, and the server
 * rejects the cases the old client-side insert allowed: requesting your
 * own ride, or requesting the same ride twice.
 */
router.post("/", async (req, res, next) => {
  try {
    const { rideId } = req.body || {};

    if (!rideId) return res.status(400).json({ error: "rideId is required." });

    const { data: ride, error: rideError } = await db
      .from("rides")
      .select("id, driver_id, seats")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) throw rideError;
    if (!ride) return res.status(404).json({ error: "That ride no longer exists." });

    if (ride.driver_id === req.user.id) {
      return res.status(400).json({ error: "You cannot request your own ride." });
    }

    const { data: existing } = await db
      .from("trip_requests")
      .select("id, status")
      .eq("ride_id", rideId)
      .eq("rider_id", req.user.id)
      .maybeSingle();

    if (existing) {
      return res
        .status(409)
        .json({ error: `You have already requested this ride (${existing.status}).` });
    }

    // Do not oversell the vehicle.
    const { data: accepted } = await db
      .from("trip_requests")
      .select("id")
      .eq("ride_id", rideId)
      .eq("status", "accepted");

    if ((accepted?.length || 0) >= (ride.seats || 1)) {
      return res.status(409).json({ error: "This ride is already full." });
    }

    const { data, error } = await db
      .from("trip_requests")
      .insert({ ride_id: rideId, rider_id: req.user.id, status: "pending" })
      .select()
      .single();

    // The check above loses a race between two clicks landing together;
    // the unique index on (ride_id, rider_id) does not. Both paths end
    // in the same answer, so a double-click can never open two requests.
    if (error?.code === "23505") {
      return res.status(409).json({ error: "You have already requested this ride." });
    }

    if (error) throw error;

    res.status(201).json({ request: data });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/requests/:id — accept or decline.
 *
 * Only the driver of the ride being requested may do this.
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const { status } = req.body || {};

    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${STATUSES.join(", ")}.` });
    }

    const { data: request, error: findError } = await db
      .from("trip_requests")
      .select("id, ride_id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;
    if (!request) return res.status(404).json({ error: "Request not found." });

    const { data: ride } = await db
      .from("rides")
      .select("driver_id, seats")
      .eq("id", request.ride_id)
      .maybeSingle();

    if (ride?.driver_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Only the driver of this ride can answer its requests." });
    }

    if (status === "accepted") {
      const { data: accepted } = await db
        .from("trip_requests")
        .select("id")
        .eq("ride_id", request.ride_id)
        .eq("status", "accepted");

      if ((accepted?.length || 0) >= (ride.seats || 1)) {
        return res.status(409).json({ error: "No seats left on this ride." });
      }
    }

    const { data, error } = await db
      .from("trip_requests")
      .update({ status })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ request: data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/requests/:id — call it off.
 *
 * Either side may. A rider changes their plans; a driver drops someone
 * they had accepted. The row is removed rather than marked cancelled,
 * which frees the seat and — because of the unique index on
 * (ride_id, rider_id) — leaves the rider free to ask again later.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const { data: request, error: findError } = await db
      .from("trip_requests")
      .select("id, ride_id, rider_id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;
    if (!request) return res.status(404).json({ error: "Request not found." });

    const { data: ride } = await db
      .from("rides")
      .select("driver_id")
      .eq("id", request.ride_id)
      .maybeSingle();

    const isRider = request.rider_id === req.user.id;
    const isDriver = ride?.driver_id === req.user.id;

    if (!isRider && !isDriver) {
      return res
        .status(403)
        .json({ error: "Only the rider or the driver can cancel this." });
    }

    const { error } = await db.from("trip_requests").delete().eq("id", req.params.id);

    if (error) throw error;

    res.json({ ok: true, cancelledBy: isRider ? "rider" : "driver" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
