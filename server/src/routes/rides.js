const express = require("express");
const { db } = require("../db");
const { computeRoute } = require("../geo");
const { rankRides, withProximity, minutesOfDay, NEARBY_RADIUS_M } = require("../match");

const router = express.Router();

/**
 * Database row -> the shape the client renders.
 *
 * `context` carries what the board looks like *to the caller*: whether
 * they already asked for a seat, and whether they are the driver. The
 * client cannot work either of these out on its own, and both decide
 * what the request button is allowed to do.
 */
function toRide(row, completedByDriver = {}, context = {}) {
  const mine = context.myRequests?.[row.id] || null;
  const taken = context.seatsTaken?.[row.id] || 0;
  const seats = row.seats || 1;
  const driver = context.drivers?.[row.driver_id] || null;

  return {
    id: row.id,
    driverId: row.driver_id,
    name: row.driver_name,
    initials: row.driver_name?.slice(0, 2).toUpperCase() || "YO",
    role: driver?.role ? driver.role[0].toUpperCase() + driver.role.slice(1) : "Student",
    vehicle: row.vehicle
      ? row.vehicle.charAt(0).toUpperCase() + row.vehicle.slice(1)
      : null,

    pickup: row.pickup,
    dropoff: row.dropoff,
    date: row.date,
    time: row.time,
    seats: row.seats,

    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    dropoffLat: row.dropoff_lat,
    dropoffLng: row.dropoff_lng,

    routeGeometry: row.route_geometry,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,

    tripStatus: row.trip_status || "scheduled",

    completedRides: completedByDriver[row.driver_id] || 0,
    createdAt: row.created_at,

    // The plate a rider will be looking for at the kerb, and the driver's
    // real role rather than the "Student" this used to hardcode.
    vehicleNumber: driver?.vehicle_number ?? null,
    driverRole: driver?.role ?? null,

    // A phone number is shared, never published. It is released only to
    // the driver themselves and to a rider they have actually accepted —
    // browsing the board reveals nobody's number.
    driverPhone:
      mine?.status === "accepted" || row.driver_id === context.userId
        ? driver?.phone ?? null
        : null,

    // Caller-relative state. The button on the card reads these rather
    // than guessing, so a reload cannot lose the fact that you already
    // asked for this seat.
    isMine: context.userId ? row.driver_id === context.userId : false,
    myRequestStatus: mine?.status ?? null,
    myRequestId: mine?.id ?? null,

    seatsTaken: taken,
    seatsLeft: Math.max(0, seats - taken),
    full: taken >= seats,
  };
}

/**
 * Everything about a board of rides that depends on who is asking:
 * the caller's own requests, and how many seats are already spoken for.
 *
 * Two queries for the whole board rather than one per card.
 */
async function callerContext(rows, userId) {
  const ids = rows.map((r) => r.id);

  if (ids.length === 0) return { userId, myRequests: {}, seatsTaken: {}, drivers: {} };

  const driverIds = [...new Set(rows.map((r) => r.driver_id))];

  const [own, accepted, profiles] = await Promise.all([
    db
      .from("trip_requests")
      .select("id, ride_id, status")
      .eq("rider_id", userId)
      .in("ride_id", ids),
    db
      .from("trip_requests")
      .select("ride_id")
      .eq("status", "accepted")
      .in("ride_id", ids),
    db.from("profiles").select("id, role, vehicle_number, phone").in("id", driverIds),
  ]);

  const myRequests = {};
  for (const r of own.data || []) {
    myRequests[r.ride_id] = { id: r.id, status: r.status };
  }

  const seatsTaken = {};
  for (const r of accepted.data || []) {
    seatsTaken[r.ride_id] = (seatsTaken[r.ride_id] || 0) + 1;
  }

  const drivers = {};
  for (const p of profiles.data || []) {
    drivers[p.id] = p;
  }

  return { userId, myRequests, seatsTaken, drivers };
}

/** Accepted-request counts per driver — the reliability signal. */
async function completedCounts(rows) {
  const rideToDriver = new Map(rows.map((r) => [r.id, r.driver_id]));

  if (rideToDriver.size === 0) return {};

  const { data } = await db
    .from("trip_requests")
    .select("ride_id")
    .eq("status", "accepted")
    .in("ride_id", [...rideToDriver.keys()]);

  const counts = {};

  for (const request of data || []) {
    const driverId = rideToDriver.get(request.ride_id);
    if (driverId) counts[driverId] = (counts[driverId] || 0) + 1;
  }

  return counts;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /api/rides
 *
 * The search endpoint. Filtering by proximity and ranking by match
 * quality both happen here, so the ordering the rider sees is decided by
 * the server rather than assembled in the browser.
 *
 * Query: fromLat, fromLng, toLat, toLng, arriveBy (HH:MM), vehicle,
 *        lat, lng (the rider's current position), radius (metres),
 *        nearbyOnly ("true" to drop rides outside the radius)
 */
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await db
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = data || [];

    const [counts, context] = await Promise.all([
      completedCounts(rows),
      callerContext(rows, req.user.id),
    ]);

    const rides = rows.map((row) => toRide(row, counts, context));

    const q = req.query;

    const criteria = {
      pickup:
        q.fromLat && q.fromLng
          ? { lat: Number(q.fromLat), lng: Number(q.fromLng) }
          : null,
      dropoff:
        q.toLat && q.toLng ? { lat: Number(q.toLat), lng: Number(q.toLng) } : null,
      arriveBy: minutesOfDay(q.arriveBy),
      vehicle: q.vehicle,
    };

    const here =
      q.lat && q.lng ? { lat: Number(q.lat), lng: Number(q.lng) } : null;

    const radius = numberOr(q.radius, NEARBY_RADIUS_M);

    const searched = Boolean(criteria.pickup && criteria.dropoff);

    const ranked = rankRides(rides, criteria);
    const withDistance = withProximity(ranked, here, radius);

    // rankRides orders by match score, but that only means something once
    // a route was given. Browsing from a known position is ordered by how
    // close each ride passes instead.
    if (!searched && here) {
      withDistance.sort(
        (a, b) => (a.distanceFromMe ?? Infinity) - (b.distanceFromMe ?? Infinity)
      );
    }

    const nearbyOnly = q.nearbyOnly === "true" && here;
    const visible = nearbyOnly ? withDistance.filter((r) => r.nearby) : withDistance;

    res.json({
      rides: visible,
      total: withDistance.length,
      hidden: withDistance.length - visible.length,
      radius,
      searched,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/rides/:id */
router.get("/:id", async (req, res, next) => {
  try {
    const { data, error } = await db
      .from("rides")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Ride not found." });

    const [counts, context] = await Promise.all([
      completedCounts([data]),
      callerContext([data], req.user.id),
    ]);

    res.json({ ride: toRide(data, counts, context) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rides
 *
 * Posts a ride. The server computes the road route itself rather than
 * trusting geometry from the browser, and takes the driver's identity
 * from the verified token rather than the request body.
 */
router.post("/", async (req, res, next) => {
  try {
    const { pickup, dropoff, date, time, seats, vehicle } = req.body || {};

    const missing = [];
    if (!pickup?.label || pickup.lat == null || pickup.lng == null) missing.push("pickup");
    if (!dropoff?.label || dropoff.lat == null || dropoff.lng == null) missing.push("dropoff");
    if (!date) missing.push("date");
    if (!time) missing.push("time");

    if (missing.length) {
      return res
        .status(400)
        .json({ error: `Missing or incomplete: ${missing.join(", ")}.` });
    }

    const seatCount = numberOr(seats, 1);

    if (seatCount < 1 || seatCount > 6) {
      return res.status(400).json({ error: "Seats must be between 1 and 6." });
    }

    // Computed here, not accepted from the client.
    const route = await computeRoute(pickup, dropoff);

    const { data, error } = await db
      .from("rides")
      .insert({
        driver_id: req.user.id,
        driver_name: req.user.name,

        pickup: pickup.label,
        dropoff: dropoff.label,

        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,

        route_geometry: route.geometry,
        distance_meters: route.distanceMeters,
        duration_seconds: route.durationSeconds,

        date,
        time,
        vehicle: vehicle || "car",
        seats: seatCount,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ ride: toRide(data, {}, { userId: req.user.id }) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/rides/:id — drivers may only remove their own rides. */
router.delete("/:id", async (req, res, next) => {
  try {
    const { data: ride, error: findError } = await db
      .from("rides")
      .select("driver_id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;
    if (!ride) return res.status(404).json({ error: "Ride not found." });

    // The ownership check the client-side version never had.
    if (ride.driver_id !== req.user.id) {
      return res.status(403).json({ error: "You can only remove your own rides." });
    }

    const { error } = await db.from("rides").delete().eq("id", req.params.id);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ tracking

const TRIP_STATUSES = ["scheduled", "to_pickup", "arrived", "started", "completed"];

// A position older than this is not where anyone is now. The app it came
// from was probably backgrounded or closed.
const STALE_AFTER_MS = 45 * 1000;

/**
 * Who is allowed to watch this ride, and in which role.
 *
 * The driver, and the riders they have accepted. Nobody else — a live
 * position is the most sensitive thing this app holds, and it must not
 * leak to someone who merely asked for a seat, let alone to the board.
 */
async function trackingAccess(rideId, userId) {
  const { data: ride } = await db
    .from("rides")
    .select(
      "id, driver_id, trip_status, live_lat, live_lng, live_heading, live_at, " +
        "pickup, dropoff, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng"
    )
    .eq("id", rideId)
    .maybeSingle();

  if (!ride) return { ride: null, role: null };

  if (ride.driver_id === userId) return { ride, role: "driver" };

  const { data: accepted } = await db
    .from("trip_requests")
    .select("id")
    .eq("ride_id", rideId)
    .eq("rider_id", userId)
    .eq("status", "accepted")
    .maybeSingle();

  return { ride, role: accepted ? "rider" : null };
}

/**
 * POST /api/rides/:id/location
 *
 * The driver's own position, as they move. Only the driver may write it,
 * and only ever their own — the id comes from the token.
 */
router.post("/:id/location", async (req, res, next) => {
  try {
    const { lat, lng, heading } = req.body || {};

    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return res.status(400).json({ error: "lat and lng are required." });
    }

    const { ride, role } = await trackingAccess(req.params.id, req.user.id);

    if (!ride) return res.status(404).json({ error: "Ride not found." });

    if (role !== "driver") {
      return res.status(403).json({ error: "Only the driver reports this ride's position." });
    }

    const { error } = await db
      .from("rides")
      .update({
        live_lat: Number(lat),
        live_lng: Number(lng),
        live_heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
        live_at: new Date().toISOString(),

        // Moving at all means the trip has begun, unless it is further
        // along already.
        ...(ride.trip_status === "scheduled" ? { trip_status: "to_pickup" } : {}),
      })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rides/:id/trip — move the trip along.
 *
 * "arrived" is the message the rider is waiting for; "started" means the
 * leg to the pickup is over and the ride itself is under way.
 */
router.post("/:id/trip", async (req, res, next) => {
  try {
    const { status } = req.body || {};

    if (!TRIP_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of ${TRIP_STATUSES.join(", ")}.` });
    }

    const { ride, role } = await trackingAccess(req.params.id, req.user.id);

    if (!ride) return res.status(404).json({ error: "Ride not found." });

    if (role !== "driver") {
      return res.status(403).json({ error: "Only the driver can update the trip." });
    }

    const { data, error } = await db
      .from("rides")
      .update({ trip_status: status })
      .eq("id", req.params.id)
      .select("trip_status")
      .single();

    if (error) throw error;

    res.json({ tripStatus: data.trip_status });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rides/:id/live — where the driver is now.
 *
 * `stale` says the last fix is too old to be trusted rather than hiding
 * it: a marker frozen in the wrong street with no explanation is worse
 * than one openly marked as last seen a minute ago.
 */
router.get("/:id/live", async (req, res, next) => {
  try {
    const { ride, role } = await trackingAccess(req.params.id, req.user.id);

    if (!ride) return res.status(404).json({ error: "Ride not found." });

    if (!role) {
      return res.status(403).json({ error: "This ride is not yours to track." });
    }

    const at = ride.live_at ? new Date(ride.live_at).getTime() : null;

    res.json({
      role,
      tripStatus: ride.trip_status || "scheduled",

      driver:
        ride.live_lat != null
          ? {
              lat: ride.live_lat,
              lng: ride.live_lng,
              heading: ride.live_heading,
              at: ride.live_at,
              stale: at == null || Date.now() - at > STALE_AFTER_MS,
            }
          : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, toRide };
