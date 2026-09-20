const express = require("express");
const { db } = require("../db");
const notify = require("../email");
const config = require("../config");
const { fareDetail } = require("../pricing");
const { departed, departureIso, departureInstant } = require("../expiry");

const router = express.Router();

const STATUSES = ["pending", "accepted", "declined"];

/**
 * The ride as a notification needs to describe it, plus how full it is.
 *
 * Loaded separately from the checks above, which deliberately select
 * only what they need to make a decision.
 */
async function rideForEmail(rideId) {
  const { data: ride } = await db
    .from("rides")
    .select("id, driver_id, pickup, dropoff, date, time, seats, vehicle")
    .eq("id", rideId)
    .maybeSingle();

  if (!ride) return null;

  const { data: accepted } = await db
    .from("trip_requests")
    .select("id")
    .eq("ride_id", rideId)
    .eq("status", "accepted");

  const taken = accepted?.length || 0;

  return { ...ride, seatsLeft: Math.max(0, (ride.seats || 1) - taken) };
}

/** The driver, as the rider needs to see them: who to look for at the kerb. */
async function driverForEmail(driverId) {
  const { data } = await db
    .from("profiles")
    .select("name, phone, vehicle_number")
    .eq("id", driverId)
    .maybeSingle();

  return data || null;
}

// Housekeeping for trips that are over.
//
// A trip stops being listed the moment it is done — a finished ride drops
// out of Upcoming and into History on its own, which is the part anybody
// actually sees. This is the slower half: eventually the row goes too,
// rather than every trip anyone has ever taken sitting in the table for
// good.
//
// Not immediately, though, and that is the whole design of it. The window
// is what "Report a problem" runs on: most trouble is only obvious once a
// trip is over and the live screen has been closed, and a rider who gets
// home and realises something was wrong has to find the trip to report it.
// Deleting the trip the moment the driver marks it complete would hand the
// person with something to report the one screen where the evidence used
// to be, empty. A week is long enough to get around to it and short enough
// that nothing piles up.
//
// Once a ride's last request is gone this way, the ride itself becomes
// deletable and the sweeper in sweepRides.js takes it on its next pass.
const PURGE_AFTER_DAYS = config.tripHistoryDays;

// Every signed-in driver polls the incoming endpoint every few seconds,
// so sweeping on each call would mean constant pointless deletes. Once
// per interval per server process is plenty for a daily cleanup.
const SWEEP_EVERY_MS = 10 * 60 * 1000;

let lastSweep = 0;

/**
 * Delete trips whose ride departed more than PURGE_AFTER_DAYS ago.
 * Returns the number removed, or 0 when the sweep was skipped.
 *
 * Every status, not just the unanswered ones it used to cover: an
 * accepted trip from last month is as much dead weight as a request
 * nobody answered, and the retention window is what protects both.
 *
 * Departure is a date column plus a time column, which the database
 * cannot compare in one filter, so the range is narrowed by date and the
 * exact cut is made here.
 */
async function purgeExpiredRequests() {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return 0;

  lastSweep = Date.now();

  const cutoff = Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);

  const { data: oldRides, error } = await db
    .from("rides")
    .select("id, date, time")
    .lte("date", cutoffDate);

  if (error) throw error;

  const ids = (oldRides || [])
    .filter((ride) => {
      const departure = departureInstant(ride);

      // A row we cannot read a departure from is left alone rather than
      // guessed at — deleting the wrong request is not recoverable.
      return departure != null && departure < cutoff;
    })
    .map((ride) => ride.id);

  // Requests whose ride has been withdrawn entirely. Nothing can be done
  // with one — there is no route, no time and nobody to travel with — so
  // it goes with the same sweep rather than sitting in a rider's list
  // forever as a card with no journey on it.
  const { data: liveRides } = await db.from("rides").select("id");
  const existing = new Set((liveRides || []).map((r) => r.id));

  const { data: allRequests } = await db.from("trip_requests").select("id, ride_id");

  const orphaned = (allRequests || [])
    .filter((r) => r.ride_id && !existing.has(r.ride_id))
    .map((r) => r.id);

  if (orphaned.length) {
    const { data: gone } = await db
      .from("trip_requests")
      .delete()
      .in("id", orphaned)
      .select("id");

    if (gone?.length) {
      console.log(
        `Purged ${gone.length} request${gone.length === 1 ? "" : "s"} whose ride was withdrawn.`
      );
    }
  }

  if (!ids.length) return 0;

  const { data: removed, error: deleteError } = await db
    .from("trip_requests")
    .delete()
    .in("ride_id", ids)
    .select("id");

  if (deleteError) throw deleteError;

  const count = removed?.length || 0;

  if (count) {
    console.log(
      `Purged ${count} trip${count === 1 ? "" : "s"} ` +
        `on rides that departed over ${PURGE_AFTER_DAYS} days ago.`
    );
  }

  return count;
}

// Where a trip stands, which decides both the order it is listed in and
// which tab it belongs to.
//
// Worked out here rather than in the browser because it is the same
// question for both sides of the app, and because the ride's trip status
// and its departure are both already loaded here — the client would have
// to be sent the parts and re-derive it, and would eventually derive it
// differently.
const RUNNING = ["to_pickup", "arrived", "started"];

function tripState(request, ride) {
  if (request.status === "declined") return "declined";

  // The ride itself is gone — the driver withdrew it. There is nothing
  // left to track, view or turn up for, so it cannot sit in Upcoming
  // pretending to be a commute somebody has planned around.
  if (!ride) return "finished";

  const tripStatus = ride?.trip_status || "scheduled";

  // Under way right now. This is the trip the rider is standing at a kerb
  // waiting for, so nothing else has any business above it.
  //
  // Bounded by the same grace period the ride sweeper uses, because the
  // driver is the only one who can mark a trip finished and plenty never
  // do — they arrive, get on with their day, and the app is the last
  // thing on their mind. Without the bound, one forgotten trip would sit
  // at the top of a rider's list announcing itself as happening now for
  // the rest of time, which is worse than useless: it is the exact spot
  // the genuinely live trip needs.
  if (
    request.status === "accepted" &&
    RUNNING.includes(tripStatus) &&
    !departed(ride, config.rideGraceMinutes * 60000)
  ) {
    return "live";
  }

  // The driver has marked it done.
  if (tripStatus === "completed") return "finished";

  // It left. Either it ran without ever being marked finished, or nobody
  // ever answered the request and the moment has passed.
  if (departed(ride)) return "finished";

  return "upcoming";
}

// Live first, then what is coming, then what is over.
const STATE_ORDER = { live: 0, upcoming: 1, finished: 2, declined: 3 };

/**
 * The order a rider actually wants: the trip happening now at the top,
 * then the next one they have to be somewhere for, then the past.
 *
 * Within what is still ahead, soonest first — the 08:00 before the 18:00.
 * Within the past, most recent first, because a trip that ended an hour
 * ago is the one worth looking at and last month's is not.
 */
function byUrgency(a, b) {
  const rank = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);

  if (rank !== 0) return rank;

  const at = Date.parse(a.departsAt) || 0;
  const bt = Date.parse(b.departsAt) || 0;

  const done = a.state === "finished" || a.state === "declined";

  return done ? bt - at : at - bt;
}

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

        // The same number the board showed when the seat was requested.
        fare: fareDetail(ride?.vehicle, ride?.distance_meters),

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

        // Where this trip stands, and when it leaves as an instant. The
        // two together are what put the live trip at the top of the list
        // and move a finished one out of the way.
        state: tripState(r, ride),
        departsAt: departureIso(ride || {}),

        // Said plainly rather than rendered as a card with empty fields,
        // which is what a withdrawn ride used to look like.
        rideMissing: !ride,
      };
    });

    trips.sort(byUrgency);

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
    // Cheap and throttled. A failure here is housekeeping, not the
    // driver's request, so it must never break the response.
    await purgeExpiredRequests().catch((err) =>
      console.error("Expired-request sweep failed:", err.message)
    );

    const { data: myRides, error } = await db
      .from("rides")
      .select(
        "id, pickup, dropoff, date, time, seats, vehicle, distance_meters, trip_status"
      )
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

        // Carries the departure as an instant, like every other ride the
        // API hands out. Without it the browser falls back to reading the
        // date and time columns in its own timezone, which is a different
        // moment from the one the campus means — so a driver travelling,
        // or simply with a machine set to another zone, would see requests
        // expire an hour early or an hour late.
        ride: ride ? { ...ride, departsAt: departureIso(ride) } : null,
        position: seenPerRide[r.ride_id],
        seats,
        seatsLeft: Math.max(0, seats - taken),
        riderName: rider?.name || "Unknown rider",

        // What this rider contributes, shown to the driver too — the two
        // of them should never be looking at different numbers.
        fare: fareDetail(ride?.vehicle, ride?.distance_meters),

        // Same rule in the other direction: a driver gets the number only
        // for a rider they have said yes to.
        riderPhone: r.status === "accepted" ? rider?.phone || null : null,

        // How far along the trip is, and whether it is still a journey at
        // all. The driver's way back to the live map is offered on this:
        // a trip that is over has no map worth opening.
        tripStatus: ride?.trip_status || "scheduled",
        state: tripState(r, ride),
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
      .select("id, driver_id, seats, date, time")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) throw rideError;
    if (!ride) return res.status(404).json({ error: "That ride no longer exists." });

    if (ride.driver_id === req.user.id) {
      return res.status(400).json({ error: "You cannot request your own ride." });
    }

    // The board stops showing a ride the moment it leaves, but a page left
    // open since before then still has the card on it. Asking for a seat in
    // a car that has already gone would email the driver about a trip they
    // cannot answer, so the answer comes from here rather than from how
    // fresh the rider's browser happens to be.
    if (departed(ride)) {
      return res
        .status(409)
        .json({ error: "That ride has already left. Refresh to see what is still going." });
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

    // After the response, never in front of it. A slow mail server must
    // not be why a rider waits to hear their request went through.
    rideForEmail(rideId)
      .then((full) =>
        notify.notifyRequestReceived({
          request: data,
          ride: full,
          driverId: ride.driver_id,
          riderName: req.user.name,
        })
      )
      .catch((err) => console.error("Request email failed:", err.message));
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

    if (status === "accepted" || status === "declined") {
      Promise.all([rideForEmail(request.ride_id), driverForEmail(req.user.id)])
        .then(([full, driver]) =>
          notify.notifyRequestAnswered({
            status,
            riderId: data.rider_id,
            driver,
            ride: full,
          })
        )
        .catch((err) => console.error("Answer email failed:", err.message));
    }
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
      .select("id, ride_id, rider_id, status")
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

    // Only a seat that was actually confirmed is worth an email. Calling
    // off a request nobody had answered yet is not news to anyone: the
    // driver never agreed to it, and the rider was not expecting a lift.
    if (request.status === "accepted") {
      rideForEmail(request.ride_id)
        .then((full) =>
          notify.notifyCancelled({
            // Whoever did not do the cancelling is the one who needs to
            // know — they are the one who would otherwise be waiting.
            toUserId: isRider ? ride?.driver_id : request.rider_id,
            byName: req.user.name,
            byRole: isRider ? "rider" : "driver",
            ride: full,
          })
        )
        .catch((err) => console.error("Cancellation email failed:", err.message));
    }
  } catch (err) {
    next(err);
  }
});

// --- messages -----------------------------------------------------------
//
// A thread belongs to one accepted request, which is to say to exactly two
// people: the driver of that ride and the one rider they took on. Nobody
// else can read or write it, and there is nothing to read before the seat
// was accepted — a thread on a pending request would be a way to pester a
// driver who has not agreed to anything.

// Long enough for directions to a side gate, short enough that the column
// is never used to store something else.
const MESSAGE_MAX = 1000;

/**
 * Who this caller is on this request, or null if they are neither party.
 *
 * Returns the other person's id too, because every use of this needs it:
 * a message is addressed to them, and a report is about them.
 */
async function threadAccess(requestId, userId) {
  const { data: request } = await db
    .from("trip_requests")
    .select("id, ride_id, rider_id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!request) return null;

  const { data: ride } = await db
    .from("rides")
    .select("id, driver_id, pickup, dropoff")
    .eq("id", request.ride_id)
    .maybeSingle();

  if (!ride) return null;

  if (ride.driver_id === userId) {
    return { request, ride, role: "driver", otherId: request.rider_id };
  }

  if (request.rider_id === userId) {
    return { request, ride, role: "rider", otherId: ride.driver_id };
  }

  return null;
}

/** The two people on a thread, by name, so a message has a sender. */
async function namesFor(ids) {
  const { data } = await db
    .from("profiles")
    .select("id, name")
    .in("id", ids.filter(Boolean));

  return Object.fromEntries((data || []).map((p) => [p.id, p.name]));
}

/**
 * GET /api/requests/:id/messages
 *
 * The whole thread, oldest first. Reading it marks the other person's
 * messages as read — opening the thread *is* having read them, and a
 * separate "mark read" call would only ever be sent at the same moment.
 */
router.get("/:id/messages", async (req, res, next) => {
  try {
    const access = await threadAccess(req.params.id, req.user.id);

    if (!access) return res.status(404).json({ error: "No such trip." });

    if (access.request.status !== "accepted") {
      return res
        .status(403)
        .json({ error: "Messages open once the seat is accepted." });
    }

    const { data: rows, error } = await db
      .from("trip_messages")
      .select("id, sender_id, body, created_at, read_at")
      .eq("request_id", req.params.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const names = await namesFor([req.user.id, access.otherId]);

    const unread = (rows || []).filter(
      (m) => m.sender_id !== req.user.id && !m.read_at
    );

    if (unread.length) {
      await db
        .from("trip_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unread.map((m) => m.id));
    }

    res.json({
      role: access.role,
      withName: names[access.otherId] || null,

      messages: (rows || []).map((m) => ({
        id: m.id,
        body: m.body,
        at: m.created_at,
        mine: m.sender_id === req.user.id,
        senderName: names[m.sender_id] || null,

        // Reflect the write above rather than the row we read a moment
        // ago, so the tick appears on the same load that caused it.
        readAt: m.sender_id === req.user.id ? m.read_at : new Date().toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/requests/:id/messages
 *
 * The sender is the token, never the body: nobody can post as the other
 * person by asking nicely.
 */
router.post("/:id/messages", async (req, res, next) => {
  try {
    const body = String(req.body?.body || "").trim();

    if (!body) return res.status(400).json({ error: "Write something first." });

    if (body.length > MESSAGE_MAX) {
      return res
        .status(400)
        .json({ error: `Messages are limited to ${MESSAGE_MAX} characters.` });
    }

    const access = await threadAccess(req.params.id, req.user.id);

    if (!access) return res.status(404).json({ error: "No such trip." });

    if (access.request.status !== "accepted") {
      return res
        .status(403)
        .json({ error: "Messages open once the seat is accepted." });
    }

    const { data, error } = await db
      .from("trip_messages")
      .insert({ request_id: req.params.id, sender_id: req.user.id, body })
      .select("id, body, created_at")
      .single();

    if (error) throw error;

    res.status(201).json({
      message: { id: data.id, body: data.body, at: data.created_at, mine: true },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/requests/unread
 *
 * How many messages are waiting, per trip, so the tab can carry a badge
 * without opening every thread.
 */
router.get("/unread", async (req, res, next) => {
  try {
    // Every trip this person is on, from either side.
    const { data: mine } = await db
      .from("trip_requests")
      .select("id")
      .eq("rider_id", req.user.id)
      .eq("status", "accepted");

    const { data: myRides } = await db
      .from("rides")
      .select("id")
      .eq("driver_id", req.user.id);

    const { data: onMyRides } = myRides?.length
      ? await db
          .from("trip_requests")
          .select("id")
          .in("ride_id", myRides.map((r) => r.id))
          .eq("status", "accepted")
      : { data: [] };

    const ids = [...new Set([...(mine || []), ...(onMyRides || [])].map((r) => r.id))];

    if (!ids.length) return res.json({ unread: {}, total: 0 });

    const { data: rows, error } = await db
      .from("trip_messages")
      .select("request_id, sender_id, read_at")
      .in("request_id", ids)
      .is("read_at", null);

    if (error) throw error;

    const unread = {};

    for (const row of rows || []) {
      // Your own unread message is one the other person has not opened —
      // not something waiting for you.
      if (row.sender_id === req.user.id) continue;

      unread[row.request_id] = (unread[row.request_id] || 0) + 1;
    }

    res.json({
      unread,
      total: Object.values(unread).reduce((sum, n) => sum + n, 0),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.threadAccess = threadAccess;
