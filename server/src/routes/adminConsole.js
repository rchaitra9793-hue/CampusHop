const express = require("express");
const { db } = require("../db");
const { invalidateUser } = require("../auth");
const { ratingsFor } = require("../ratings");
const { departed } = require("../expiry");
const { CATEGORIES } = require("./reports");
const crypto = require("crypto");
const config = require("../config");
const email_ = require("../email");

const router = express.Router();

// The lifecycle 007 documented on safety_reports.status the day the table
// was created, and which nothing until now could move a report along.
const STATUSES = ["open", "reviewing", "resolved", "dismissed"];

const NOTE_MAX = 1000;

/**
 * Records an admin action.
 *
 * Every state change below goes through here. A suspended account with
 * nothing saying who suspended it, or why, cannot be reviewed by anybody
 * afterwards, which makes the suspension itself impossible to undo fairly.
 *
 * A failure here does not fail the request: the action has already
 * happened by the time this is written, and refusing a completed
 * suspension because its log row would not insert leaves the two
 * disagreeing about what is true. It is logged loudly instead.
 */
async function record(adminId, action, targetId, note) {
  const { error } = await db.from("admin_actions").insert({
    admin_id: adminId,
    action,
    target_id: targetId ?? null,
    note: note ? String(note).slice(0, NOTE_MAX) : null,
  });

  if (error) {
    console.error(
      `  Could not write audit row (${action} on ${targetId}):`,
      error.message
    );
  }
}

/** Names and emails for a set of profile ids, as a lookup. */
async function profilesById(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];

  if (!wanted.length) return new Map();

  const { data } = await db
    .from("profiles")
    .select("id, name, email, role, is_admin, suspended_at")
    .in("id", wanted);

  return new Map((data || []).map((p) => [p.id, p]));
}

// Split in two because 011 may not have been run yet, and the queue has
// to keep working either way.
const REPORT_COLUMNS =
  "id, category, details, status, created_at, reporter_id, subject_id, " +
  "ride_id, request_id";

const DECISION_COLUMNS = "resolution, resolved_at, resolved_by";

/** Whether an error is "011 has not been run here". */
function missingDecisionColumns(error) {
  return (
    error?.code === "42703" ||
    /resolution|resolved_at|resolved_by/i.test(error?.message || "")
  );
}

let said011 = false;

/** Said once per process, not once per request. */
function warnAbout011() {
  if (said011) return;

  said011 = true;

  console.warn(
    "\n  db/011_admin_detail.sql has not been run on this database.\n" +
      "  The dashboard works, but a report's decision is kept only in the\n" +
      "  audit log rather than on the report. Run the migration.\n"
  );
}

/** The trips a set of reports point at, as a lookup. */
async function ridesById(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];

  if (!wanted.length) return new Map();

  const { data } = await db
    .from("rides")
    .select("id, pickup, dropoff, date, time, driver_id")
    .in("id", wanted);

  return new Map((data || []).map((r) => [r.id, r]));
}

/** Accepted seats per ride, so a ride can say how full it is. */
async function seatsTakenFor(rideIds) {
  const wanted = [...new Set((rideIds || []).filter(Boolean))];

  if (!wanted.length) return {};

  const { data } = await db
    .from("trip_requests")
    .select("ride_id")
    .eq("status", "accepted")
    .in("ride_id", wanted);

  const out = {};

  for (const row of data || []) {
    out[row.ride_id] = (out[row.ride_id] || 0) + 1;
  }

  return out;
}

/**
 * How many reports have been filed about each of these people, and how
 * many of those are still open.
 *
 * One read of the whole column rather than a count per person: on a
 * single campus this table is small, and a query per row in a list of a
 * hundred accounts is the thing that makes a dashboard feel broken.
 */
async function reportCountsFor(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];

  if (!wanted.length) return {};

  const { data } = await db
    .from("safety_reports")
    .select("subject_id, status")
    .in("subject_id", wanted);

  const out = {};

  for (const row of data || []) {
    const entry = (out[row.subject_id] ??= { total: 0, open: 0 });

    entry.total += 1;

    if (row.status === "open" || row.status === "reviewing") entry.open += 1;
  }

  return out;
}

/** One person, flattened for the client. Null-safe: a profile may be gone. */
function personOut(profile, id) {
  if (!profile) {
    // The row is referenced but no longer there. Saying so beats
    // rendering a blank name, which reads as a bug in the dashboard.
    return id ? { id, name: "Deleted account", gone: true } : null;
  }

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email ?? null,
    role: profile.role ?? "student",
    isAdmin: profile.is_admin === true,
    suspended: Boolean(profile.suspended_at),
  };
}

/**
 * GET /api/admin/overview
 *
 * The numbers the dashboard opens on. Counts only — a head count is a
 * cheap query and this is the first thing loaded on every visit.
 */
router.get("/overview", async (req, res, next) => {
  try {
    // head: true asks Postgres for the count without sending the rows.
    const count = (table, apply = (q) => q) =>
      apply(db.from(table).select("*", { count: "exact", head: true }));

    const [open, reviewing, resolved, dismissed, users, suspended, admins, rides] =
      await Promise.all([
        count("safety_reports", (q) => q.eq("status", "open")),
        count("safety_reports", (q) => q.eq("status", "reviewing")),
        count("safety_reports", (q) => q.eq("status", "resolved")),
        count("safety_reports", (q) => q.eq("status", "dismissed")),
        count("profiles"),
        count("profiles", (q) => q.not("suspended_at", "is", null)),
        count("profiles", (q) => q.eq("is_admin", true)),
        count("rides"),
      ]);

    // The board as it stands, rather than everything ever posted: a count
    // that only goes up is not a number anybody acts on.
    const { data: rideRows } = await db.from("rides").select("date, time, departs_at");

    const live = (rideRows || []).filter((r) => !departed(r)).length;

    res.json({
      reports: {
        open: open.count ?? 0,
        reviewing: reviewing.count ?? 0,
        resolved: resolved.count ?? 0,
        dismissed: dismissed.count ?? 0,
      },
      users: {
        total: users.count ?? 0,
        suspended: suspended.count ?? 0,
        admins: admins.count ?? 0,
      },
      rides: { total: rides.count ?? 0, upcoming: live },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/reports
 *
 * The queue. Oldest first while a report is still waiting, because the one
 * that has been unanswered longest is the one to read next; newest first
 * once decided, because by then it is a history.
 */
router.get("/reports", async (req, res, next) => {
  try {
    const status = req.query.status;

    if (status && status !== "all" && !STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of ${STATUSES.join(", ")}, or all.` });
    }

    const category = req.query.category;

    if (category && category !== "all" && !CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ error: `category must be one of ${CATEGORIES.join(", ")}, or all.` });
    }

    const waiting = status === "open" || status === "reviewing";

    const build = (columns) => {
      let q = db
        .from("safety_reports")
        .select(columns)
        .order("created_at", { ascending: waiting })
        .limit(200);

      if (status && status !== "all") q = q.eq("status", status);
      if (category && category !== "all") q = q.eq("category", category);

      return q;
    };

    let { data: rows, error } = await build(
      `${REPORT_COLUMNS}, ${DECISION_COLUMNS}`
    );

    // A database still waiting for 011 has none of the decision columns,
    // and asking for a column that is not there fails the whole select —
    // which would leave the queue itself broken rather than merely
    // missing the resolution text. The queue is the dashboard.
    if (error && missingDecisionColumns(error)) {
      warnAbout011();

      ({ data: rows, error } = await build(REPORT_COLUMNS));
    }

    if (error) throw error;

    const [people, rides] = await Promise.all([
      profilesById(
        (rows || []).flatMap((r) => [r.reporter_id, r.subject_id, r.resolved_by])
      ),
      ridesById((rows || []).map((r) => r.ride_id)),
    ]);

    res.json({
      reports: (rows || []).map((r) => {
        const ride = rides.get(r.ride_id);

        return {
          id: r.id,
          category: r.category,
          details: r.details,
          status: r.status,
          at: r.created_at,

          reporter: personOut(people.get(r.reporter_id), r.reporter_id),

          // Null is legitimate: 007 allows a report about the trip itself
          // rather than about a person.
          subject: r.subject_id
            ? personOut(people.get(r.subject_id), r.subject_id)
            : null,

          // The trip may have been swept since. The report outlives it.
          ride: ride
            ? {
                id: ride.id,
                pickup: ride.pickup,
                dropoff: ride.dropoff,
                date: ride.date,
                time: ride.time,
              }
            : null,

          // What was decided, on the report rather than buried in the
          // audit log. 011 added these columns; before it they are
          // undefined, which reads the same as "not decided yet".
          resolution: r.resolution ?? null,
          resolvedAt: r.resolved_at ?? null,
          resolvedBy: r.resolved_by
            ? personOut(people.get(r.resolved_by), r.resolved_by)?.name ?? null
            : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/reports/:id
 *
 * Moving a report along. The only writer of anything other than 'open'.
 */
router.patch("/reports/:id", async (req, res, next) => {
  try {
    const { status, note } = req.body || {};

    if (!STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of ${STATUSES.join(", ")}.` });
    }

    const text = String(note || "").trim();

    if (text.length > NOTE_MAX) {
      return res
        .status(400)
        .json({ error: `Please keep the note under ${NOTE_MAX} characters.` });
    }

    // Deciding one way or the other is the kind of thing somebody asks
    // about months later, so it has to carry a reason.
    if ((status === "resolved" || status === "dismissed") && !text) {
      return res.status(400).json({
        error: "Say why — a resolved or dismissed report needs a note.",
      });
    }

    const { data: before } = await db
      .from("safety_reports")
      .select("id, status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!before) return res.status(404).json({ error: "No such report." });

    const decided = status === "resolved" || status === "dismissed";

    const patch = { status };

    // 011 keeps the decision on the report. Reopening clears it, because
    // a report that is open again has no decision — the audit log still
    // remembers that it once did.
    const withDecision = {
      ...patch,
      resolution: text || null,
      resolved_at: decided ? new Date().toISOString() : null,
      resolved_by: decided ? req.user.id : null,
    };

    let { data, error } = await db
      .from("safety_reports")
      .update(withDecision)
      .eq("id", req.params.id)
      .select("id, status")
      .single();

    // A database still waiting for 011 has none of those three columns.
    // The status move is the part that matters and it should not fail
    // over the record-keeping, so it is retried without them.
    if (error && missingDecisionColumns(error)) {
      warnAbout011();

      ({ data, error } = await db
        .from("safety_reports")
        .update(patch)
        .eq("id", req.params.id)
        .select("id, status")
        .single());
    }

    if (error) throw error;

    await record(
      req.user.id,
      "report.status",
      data.id,
      `${before.status} -> ${status}${text ? `: ${text}` : ""}`
    );

    res.json({ report: { id: data.id, status: data.status } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users
 *
 * Finding an account. Searched by name or email, because those are the two
 * things somebody handling a report actually has in front of them.
 */
router.get("/users", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();

    // Alphabetical here either way. The other two orders are by rating
    // and by report count, and neither is a column on this table — they
    // are applied below, once the counts have been read.
    const sort = req.query.sort || "name";

    let query = db
      .from("profiles")
      .select(
        "id, name, email, role, is_admin, suspended_at, vehicle, vehicle_number"
      )
      .order("name")
      .limit(200);

    if (req.query.role === "student") query = query.eq("role", "student");
    if (req.query.role === "faculty") query = query.eq("role", "faculty");
    if (req.query.role === "admin") query = query.eq("is_admin", true);

    if (q) {
      // Strip the characters that mean something to PostgREST's filter
      // grammar, so a search for "%" looks for a percent sign rather than
      // matching every row.
      const safe = q.replace(/[%_,().*]/g, " ").trim();

      if (safe) query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%`);
    }

    if (req.query.suspended === "true") {
      query = query.not("suspended_at", "is", null);
    }

    const { data, error } = await query;

    if (error) throw error;

    const ids = (data || []).map((p) => p.id);

    // What a list of accounts is actually scanned for: who has been
    // complained about, and how they are rated. Two queries for the whole
    // page rather than two per row.
    const [ratings, against] = await Promise.all([
      ratingsFor(ids),
      reportCountsFor(ids),
    ]);

    let users = (data || []).map((p) => ({
      ...personOut(p, p.id),
      vehicle: p.vehicle ?? null,
      vehicleNumber: p.vehicle_number ?? null,
      suspendedAt: p.suspended_at ?? null,
      rating: ratings[p.id]?.average ?? null,
      ratingCount: ratings[p.id]?.count ?? 0,
      reportsAgainst: against[p.id]?.total ?? 0,
      openReports: against[p.id]?.open ?? 0,
    }));

    // Sorted here rather than in the query, because neither of these is a
    // column: one comes from a view and one from a count.
    if (sort === "reports") {
      users.sort((a, b) => b.reportsAgainst - a.reportsAgainst);
    }

    if (sort === "rating") {
      // An unrated account is not the worst-rated one, so it goes last
      // either way rather than sorting as zero.
      users.sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99));
    }

    res.json({ users, total: users.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id
 *
 * One account, with what has been reported about them and what they have
 * reported. This is the view that answers "should this person keep
 * driving" — the question 007 built the subject index for.
 */
router.get("/users/:id", async (req, res, next) => {
  try {
    const { data: profile } = await db
      .from("profiles")
      .select(
        "id, name, email, role, is_admin, suspended_at, suspended_reason, " +
          "vehicle, vehicle_number, phone"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (!profile) return res.status(404).json({ error: "No such account." });

    const [against, filed, rides, actions] = await Promise.all([
      db
        .from("safety_reports")
        .select("id, category, details, status, created_at, reporter_id")
        .eq("subject_id", profile.id)
        .order("created_at", { ascending: false }),

      db
        .from("safety_reports")
        .select("id, category, status, created_at, subject_id")
        .eq("reporter_id", profile.id)
        .order("created_at", { ascending: false }),

      db
        .from("rides")
        .select("id, pickup, dropoff, date, time, seats")
        .eq("driver_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(20),

      db
        .from("admin_actions")
        .select("id, action, note, created_at, admin_id")
        .eq("target_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const [people, ratings] = await Promise.all([
      profilesById([
        ...(against.data || []).map((r) => r.reporter_id),
        ...(filed.data || []).map((r) => r.subject_id),
        ...(actions.data || []).map((a) => a.admin_id),
      ]),

      // How the people who travelled with them rated them. A low average
      // next to three open reports is the picture worth having.
      ratingsFor([profile.id]),
    ]);

    res.json({
      user: {
        ...personOut(profile, profile.id),
        phone: profile.phone ?? null,
        vehicle: profile.vehicle ?? null,
        vehicleNumber: profile.vehicle_number ?? null,
        suspendedAt: profile.suspended_at ?? null,
        suspendedReason: profile.suspended_reason ?? null,

        rating: ratings[profile.id]?.average ?? null,
        ratingCount: ratings[profile.id]?.count ?? 0,
      },

      reportsAgainst: (against.data || []).map((r) => ({
        id: r.id,
        category: r.category,
        details: r.details,
        status: r.status,
        at: r.created_at,
        reporter: personOut(people.get(r.reporter_id), r.reporter_id),
      })),

      reportsFiled: (filed.data || []).map((r) => ({
        id: r.id,
        category: r.category,
        status: r.status,
        at: r.created_at,
        subject: r.subject_id
          ? personOut(people.get(r.subject_id), r.subject_id)
          : null,
      })),

      rides: (rides.data || []).map((r) => ({
        id: r.id,
        pickup: r.pickup,
        dropoff: r.dropoff,
        date: r.date,
        time: r.time,
        seats: r.seats,
      })),

      history: (actions.data || []).map((a) => ({
        id: a.id,
        action: a.action,
        note: a.note,
        at: a.created_at,
        by: personOut(people.get(a.admin_id), a.admin_id)?.name ?? "Unknown",
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/suspend
 *
 * Turning an account off. Takes effect on the suspended person's very next
 * request, because their cached token is dropped here.
 */
router.post("/users/:id/suspend", async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res
        .status(400)
        .json({ error: "Say why this account is being suspended." });
    }

    if (reason.length > NOTE_MAX) {
      return res
        .status(400)
        .json({ error: `Please keep the reason under ${NOTE_MAX} characters.` });
    }

    // An admin locking themselves out would need somebody with database
    // access to undo it.
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot suspend your own account." });
    }

    const { data: target } = await db
      .from("profiles")
      .select("id, name, is_admin")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!target) return res.status(404).json({ error: "No such account." });

    // Administrators are not suspended through the dashboard. Two admins
    // in a disagreement could otherwise take turns suspending each other,
    // and nothing in here is the right place to settle that.
    if (target.is_admin) {
      return res.status(400).json({
        error:
          "Administrators cannot be suspended here. " +
          "Remove the privilege in the database first.",
      });
    }

    const { error } = await db
      .from("profiles")
      .update({
        suspended_at: new Date().toISOString(),
        suspended_reason: reason,
      })
      .eq("id", target.id);

    if (error) throw error;

    // Their token is cached for up to a minute. Without this they would
    // keep working until it expired.
    invalidateUser(target.id);

    await record(req.user.id, "user.suspend", target.id, reason);

    res.json({ ok: true, suspended: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/users/:id/reinstate — letting an account back in. */
router.post("/users/:id/reinstate", async (req, res, next) => {
  try {
    const note = String(req.body?.note || "").trim();

    const { data: target } = await db
      .from("profiles")
      .select("id, suspended_at")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!target) return res.status(404).json({ error: "No such account." });

    if (!target.suspended_at) {
      return res.status(400).json({ error: "That account is not suspended." });
    }

    const { error } = await db
      .from("profiles")
      .update({ suspended_at: null, suspended_reason: null })
      .eq("id", target.id);

    if (error) throw error;

    invalidateUser(target.id);

    await record(req.user.id, "user.reinstate", target.id, note || null);

    res.json({ ok: true, suspended: false });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/actions
 *
 * The audit log, most recent first. Readable by any admin, including rows
 * written by other admins — a log only its author can read is not much of
 * a check on anything.
 */
router.get("/actions", async (req, res, next) => {
  try {
    let query = db
      .from("admin_actions")
      .select("id, action, note, target_id, created_at, admin_id")
      .order("created_at", { ascending: false })
      .limit(300);

    // "report.", "user." or an exact verb. A prefix is what somebody
    // actually wants — "everything done to accounts" rather than having
    // to know that suspend and grant_admin are separate words.
    const action = String(req.query.action || "").trim();

    if (action && action !== "all") {
      query = action.endsWith(".")
        ? query.like("action", `${action}%`)
        : query.eq("action", action);
    }

    if (req.query.adminId) query = query.eq("admin_id", req.query.adminId);

    const { data, error } = await query;

    if (error) throw error;

    const people = await profilesById([
      ...(data || []).map((a) => a.admin_id),
      ...(data || []).map((a) => a.target_id),
    ]);

    res.json({
      actions: (data || []).map((a) => ({
        id: a.id,
        action: a.action,
        note: a.note,
        at: a.created_at,
        by: personOut(people.get(a.admin_id), a.admin_id)?.name ?? "Unknown",

        // A target is a profile for user.* actions and a report for
        // report.*, so it resolves to a name only sometimes.
        target: people.get(a.target_id)?.name ?? null,
        targetId: a.target_id,

        // report.* / user.* / ride.*, so the client can group and badge
        // without parsing the verb itself.
        kind: String(a.action || "").split(".")[0] || "other",
      })),

      // Who has done anything, for the "by" filter. Taken from the rows
      // on screen rather than from the list of current administrators:
      // somebody who has since lost the privilege is still in the log.
      admins: [
        ...new Map(
          (data || [])
            .map((a) => people.get(a.admin_id))
            .filter(Boolean)
            .map((p) => [p.id, { id: p.id, name: p.name }])
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/rides
 *
 * The ride board as an administrator sees it: every ride, not only the
 * ones still to come, with who posted it and how full it is.
 *
 * Filters: q (pickup, dropoff or driver name), state (upcoming | past),
 *          driverId.
 */
router.get("/rides", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const state = req.query.state;

    let query = db
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (req.query.driverId) query = query.eq("driver_id", req.query.driverId);

    if (q) {
      const safe = q.replace(/[%_,().*]/g, " ").trim();

      if (safe) {
        query = query.or(
          `pickup.ilike.%${safe}%,dropoff.ilike.%${safe}%,driver_name.ilike.%${safe}%`
        );
      }
    }

    const { data: rows, error } = await query;

    if (error) throw error;

    // Who posted them, and how many seats have gone.
    const driverIds = (rows || []).map((r) => r.driver_id);

    const [people, ratings, taken] = await Promise.all([
      profilesById(driverIds),
      ratingsFor(driverIds),
      seatsTakenFor((rows || []).map((r) => r.id)),
    ]);

    let rides = (rows || []).map((r) => {
      const seats = r.seats || 1;

      return {
        id: r.id,
        pickup: r.pickup,
        dropoff: r.dropoff,
        date: r.date,
        time: r.time,
        seats,
        seatsTaken: taken[r.id] || 0,
        vehicle: r.vehicle,
        tripStatus: r.trip_status || "scheduled",

        // Whether it is still joinable, decided the same way the board
        // decides it rather than by a second rule that could disagree.
        gone: departed(r),

        driver: {
          ...personOut(people.get(r.driver_id), r.driver_id),
          rating: ratings[r.driver_id]?.average ?? null,
          ratingCount: ratings[r.driver_id]?.count ?? 0,
        },
      };
    });

    if (state === "upcoming") rides = rides.filter((r) => !r.gone);
    if (state === "past") rides = rides.filter((r) => r.gone);

    res.json({ rides, total: rides.length });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/rides/:id
 *
 * Taking a ride off the board. The driver can already remove their own;
 * this is for the one that should not be there and whose driver is not
 * going to remove it.
 *
 * The requests on it go too — a seat on a ride that no longer exists is
 * not a seat — and everyone who had one is named in the audit note, since
 * that is the part nobody can reconstruct afterwards.
 */
router.delete("/rides/:id", async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res.status(400).json({ error: "Say why this ride is being removed." });
    }

    const { data: ride } = await db
      .from("rides")
      .select("id, driver_id, driver_name, pickup, dropoff, date, time")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!ride) return res.status(404).json({ error: "No such ride." });

    const { data: riders } = await db
      .from("trip_requests")
      .select("rider_id, status")
      .eq("ride_id", ride.id);

    const affected = (riders || []).filter((r) => r.status === "accepted").length;

    // The requests first: deleting the ride would cascade them anyway,
    // but doing it in this order means a failure halfway leaves a ride
    // with no requests rather than requests with no ride.
    await db.from("trip_requests").delete().eq("ride_id", ride.id);

    const { error } = await db.from("rides").delete().eq("id", ride.id);

    if (error) throw error;

    await record(
      req.user.id,
      "ride.delete",
      ride.id,
      `${ride.pickup} -> ${ride.dropoff} ${ride.date} ${ride.time} ` +
        `by ${ride.driver_name}` +
        (affected ? `, ${affected} accepted rider(s) affected` : "") +
        `: ${reason}`
    );

    res.json({ ok: true, removed: true, ridersAffected: affected });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/role
 *
 * Granting and revoking administrator.
 *
 * 009 said there is no endpoint for this on purpose, and the reasoning
 * holds for the *first* administrator: an API that can make one out of
 * nothing is an API that can be made to. This is a different thing — it
 * is behind requireAdmin, so it can only ever be used by somebody who
 * already has the privilege they are handing out, which is how every
 * other system does it.
 *
 * Three guards, all of them about not ending up with nobody in charge.
 */
router.post("/users/:id/role", async (req, res, next) => {
  try {
    const makeAdmin = req.body?.isAdmin === true;
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res
        .status(400)
        .json({ error: "Say why this privilege is changing." });
    }

    // 1. Not your own. Somebody who revokes themselves has locked the
    //    door from the inside and needs database access to get back.
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        error:
          "You cannot change your own administrator privilege. " +
          "Ask another administrator.",
      });
    }

    const { data: target } = await db
      .from("profiles")
      .select("id, name, is_admin, suspended_at")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!target) return res.status(404).json({ error: "No such account." });

    if (target.is_admin === makeAdmin) {
      return res.status(400).json({
        error: makeAdmin
          ? "They are already an administrator."
          : "They are not an administrator.",
      });
    }

    // 2. Not a suspended account. An administrator who cannot sign in is
    //    a privilege nobody can use and everybody can see.
    if (makeAdmin && target.suspended_at) {
      return res.status(400).json({
        error: "Reinstate this account before making it an administrator.",
      });
    }

    // 3. Never the last one. A board with no administrator cannot appoint
    //    the next one, which makes this the one mistake with no way back
    //    through the app at all.
    if (!makeAdmin) {
      const { count } = await db
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("is_admin", true);

      if ((count ?? 0) <= 1) {
        return res.status(400).json({
          error: "They are the only administrator left. Appoint another first.",
        });
      }
    }

    const { error } = await db
      .from("profiles")
      .update({ is_admin: makeAdmin })
      .eq("id", target.id);

    if (error) throw error;

    // Their cached token still says what they were.
    invalidateUser(target.id);

    await record(
      req.user.id,
      makeAdmin ? "user.grant_admin" : "user.revoke_admin",
      target.id,
      reason
    );

    res.json({ ok: true, isAdmin: makeAdmin });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Appointing an administrator by invitation
// ============================================================
//
// The route above appoints an existing account by id, which is right when
// the person is already on the ride board. These endpoints cover the case
// it cannot: somebody who has never signed up, or whose address is not on
// the campus domain at all — an office mailbox, a warden, staff on
// another domain.
//
// Two steps, because typing an address into a box proves nothing about
// whose address it is. First a code goes to that address; then the code
// has to come back. The invitation is a proposal until it does.

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// One live invitation per address at a time. Without this, pressing the
// button twice sends two codes and only the second works, which looks
// exactly like the first one being broken.
const RESEND_AFTER_MS = 60 * 1000;

/**
 * Enough of an email to be worth sending to.
 *
 * Deliberately loose: no domain list, no campus suffix. The `.edu.in`
 * rule lives on the signup form, where it keeps strangers off the ride
 * board. An administrator is appointed by another administrator, and
 * requiring them to also be a student is how an office account ends up
 * being somebody's personal one.
 *
 * So this checks the shape and nothing else — one @, something either
 * side, a dot in the domain, no whitespace.
 */
function emailProblem(raw) {
  const value = String(raw || "").trim();

  if (!value) return "Which address should the code go to?";
  if (value.length > 254) return "That address is too long.";
  if (/\s/.test(value)) return "An email address cannot contain spaces.";

  if (!/^[^@]+@[^@]+\.[^@]{2,}$/.test(value)) {
    return "That does not look like an email address.";
  }

  return null;
}

/** Six digits, from the system's own randomness rather than Math.random. */
function makeCode() {
  // 0–999999, padded. randomInt is uniform, which matters here: a code
  // generated by `% 1000000` on a 32-bit number is very slightly biased
  // towards the low end, and there is no reason to accept that.
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

/**
 * The stored form of a code.
 *
 * Salted with the secret the action tokens already use, so a copy of this
 * table is not a list of working codes. Read access to the database is
 * precisely what an attacker who got hold of the service key has, and
 * they should not get the invitations along with it.
 */
function hashCode(email, code) {
  return crypto
    .createHmac("sha256", config.actionSecret)
    .update(`${email}:${code}`)
    .digest("hex");
}

/** Lower-cased and trimmed, so two spellings are not two invitations. */
function normaliseEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

/** Whether the admin_invites table exists yet. */
function missingInviteTable(error) {
  return error?.code === "42P01" || /admin_invites/i.test(error?.message || "");
}

const NO_TABLE =
  "Invitations are not set up on this database yet. " +
  "Run db/012_admin_invites.sql.";

/**
 * POST /api/admin/invites
 *
 * Propose an address. Sends the code; appoints nobody.
 */
router.post("/invites", async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const reason = String(req.body?.reason || "").trim();

    const problem = emailProblem(email);

    if (problem) return res.status(400).json({ error: problem });

    if (!reason) {
      return res
        .status(400)
        .json({ error: "Say why this person is being made an administrator." });
    }

    if (reason.length > NOTE_MAX) {
      return res
        .status(400)
        .json({ error: `Please keep the reason under ${NOTE_MAX} characters.` });
    }

    // Inviting yourself is a no-op that looks like it worked.
    if (email === String(req.user.email || "").toLowerCase()) {
      return res.status(400).json({ error: "That is your own address." });
    }

    // Already an administrator? Nothing to do, and a code sent to
    // somebody who is already in would be a puzzle rather than an
    // invitation.
    const { data: existing } = await db
      .from("profiles")
      .select("id, name, is_admin, suspended_at")
      .ilike("email", email)
      .maybeSingle();

    if (existing?.is_admin) {
      return res.status(400).json({ error: "They are already an administrator." });
    }

    if (existing?.suspended_at) {
      return res.status(400).json({
        error: "That account is suspended. Reinstate it first.",
      });
    }

    // A live invitation already out?
    const { data: open, error: lookupError } = await db
      .from("admin_invites")
      .select("id, created_at, expires_at")
      .eq("email", email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (lookupError) {
      if (missingInviteTable(lookupError)) {
        return res.status(503).json({ error: NO_TABLE });
      }

      throw lookupError;
    }

    const live = open?.[0];

    if (live) {
      const age = Date.now() - new Date(live.created_at).getTime();

      if (age < RESEND_AFTER_MS) {
        const wait = Math.ceil((RESEND_AFTER_MS - age) / 1000);

        return res.status(429).json({
          error: `A code was just sent to ${email}. Try again in ${wait}s.`,
        });
      }

      // Older than the resend window: this is a genuine "it never
      // arrived", so the previous one is retired and a new one goes out.
      await db
        .from("admin_invites")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", live.id);
    }

    const code = makeCode();
    const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    const { data: invite, error } = await db
      .from("admin_invites")
      .insert({
        email,
        invited_by: req.user.id,
        reason,
        code_hash: hashCode(email, code),
        expires_at: expires.toISOString(),
      })
      .select("id, email, created_at, expires_at")
      .single();

    if (error) {
      if (missingInviteTable(error)) {
        return res.status(503).json({ error: NO_TABLE });
      }

      throw error;
    }

    // Awaited, unlike every other send in this app: an invitation whose
    // code never left is a row nobody can ever confirm. If it fails, the
    // invitation goes with it rather than sitting there looking valid.
    try {
      await email_.sendAdminInvite({
        email,
        code,
        invitedBy: req.user.name,
        reason,
        minutes: CODE_TTL_MINUTES,
      });
    } catch (err) {
      await db.from("admin_invites").delete().eq("id", invite.id);

      return res.status(err.status || 502).json({
        error:
          err.status === 503
            ? err.message
            : `Could not send the code to ${email}. ${err.message}`,
      });
    }

    await record(
      req.user.id,
      "admin.invite_sent",
      existing?.id ?? null,
      `${email}: ${reason}`
    );

    res.status(201).json({
      invite: {
        id: invite.id,
        email: invite.email,
        expiresAt: invite.expires_at,
        // Whether confirming will appoint an existing account or create
        // one, so the panel can say which.
        accountExists: Boolean(existing),
      },
      minutes: CODE_TTL_MINUTES,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/invites/verify
 *
 * The code, come back. This is the step that appoints.
 */
router.post("/invites/verify", async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const code = String(req.body?.code || "").replace(/\D/g, "");

    if (!email || code.length !== 6) {
      return res.status(400).json({ error: "Enter the six-digit code." });
    }

    const { data: rows, error: lookupError } = await db
      .from("admin_invites")
      .select("id, email, reason, attempts, expires_at, accepted_at, code_hash")
      .eq("email", email)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lookupError) {
      if (missingInviteTable(lookupError)) {
        return res.status(503).json({ error: NO_TABLE });
      }

      throw lookupError;
    }

    const invite = rows?.[0];

    if (!invite) {
      return res.status(404).json({ error: "No invitation is open for that address." });
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res
        .status(400)
        .json({ error: "That code has expired. Send a new one." });
    }

    if (invite.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({
        error: "Too many wrong attempts on this invitation. Send a new code.",
      });
    }

    // timingSafeEqual needs equal lengths; both sides are hex digests of
    // the same hash, so they always are.
    const expected = Buffer.from(invite.code_hash, "utf8");
    const given = Buffer.from(hashCode(email, code), "utf8");

    const matches =
      expected.length === given.length && crypto.timingSafeEqual(expected, given);

    if (!matches) {
      await db
        .from("admin_invites")
        .update({ attempts: invite.attempts + 1 })
        .eq("id", invite.id);

      const left = MAX_ATTEMPTS - (invite.attempts + 1);

      return res.status(400).json({
        error: left > 0
          ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "That code is not right, and this invitation is now closed.",
      });
    }

    // --- the code is good. Find or make the account. ---
    const { data: profile } = await db
      .from("profiles")
      .select("id, name, is_admin, suspended_at")
      .ilike("email", email)
      .maybeSingle();

    let userId = profile?.id ?? null;
    let created = false;

    if (!userId) {
      // Nobody has signed up on this address. Make the account, confirmed
      // — the code that just came back is the proof the address works,
      // which is the only thing a confirmation mail would have proved.
      //
      // The password is random and told to nobody: they sign in by
      // setting one through "Forgot password", which is the same path
      // anybody else uses and does not involve a password travelling by
      // email.
      const { data: made, error: createError } = await db.auth.admin.createUser({
        email,
        password: crypto.randomBytes(24).toString("base64url"),
        email_confirm: true,
      });

      if (createError) {
        return res.status(502).json({
          error: `Could not create an account for ${email}. ${createError.message}`,
        });
      }

      userId = made.user.id;
      created = true;

      // The name is not known yet; they fill it in on their profile. The
      // local part of the address is a better placeholder than "Rider".
      const { error: profileError } = await db.from("profiles").upsert(
        {
          id: userId,
          name: email.split("@")[0],
          role: "faculty",
          email,
          is_admin: true,
        },
        { onConflict: "id" }
      );

      if (profileError) throw profileError;
    } else {
      if (profile.suspended_at) {
        return res
          .status(400)
          .json({ error: "That account is suspended. Reinstate it first." });
      }

      const { error: grantError } = await db
        .from("profiles")
        .update({ is_admin: true })
        .eq("id", userId);

      if (grantError) throw grantError;

      invalidateUser(userId);
    }

    await db
      .from("admin_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", invite.id);

    await record(
      req.user.id,
      "user.grant_admin",
      userId,
      `${email} confirmed by code` +
        (created ? ", account created" : "") +
        (invite.reason ? `: ${invite.reason}` : "")
    );

    // Tell them it worked. Up to now the only person who learned the
    // outcome was the administrator typing the code in — the new one read
    // six digits out and then heard nothing. Not awaited: the
    // appointment is already true, and a slow mail server is not a reason
    // to hold the response or to pretend it did not happen.
    email_.notifyAdminAppointed({
      email,
      name: profile?.name ?? null,
      invitedBy: req.user.name,
      reason: invite.reason,
      needsPassword: created,
    });

    res.json({
      ok: true,
      isAdmin: true,
      accountCreated: created,
      userId,
      // A brand-new account has no password anybody knows, so the panel
      // has to say what happens next rather than leaving them locked out.
      needsPassword: created,
      email,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/invites
 *
 * Invitations still waiting on a code, so one that was sent and forgotten
 * is visible rather than only being a mail in somebody else's inbox.
 */
router.get("/invites", async (req, res, next) => {
  try {
    const { data, error } = await db
      .from("admin_invites")
      .select("id, email, reason, created_at, expires_at, attempts, invited_by")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      // No table is not an error here — it is an empty list and a nudge
      // in the log, so the panel still opens on a database without 012.
      if (missingInviteTable(error)) return res.json({ invites: [] });

      throw error;
    }

    const people = await profilesById((data || []).map((i) => i.invited_by));

    res.json({
      invites: (data || []).map((i) => ({
        id: i.id,
        email: i.email,
        reason: i.reason,
        at: i.created_at,
        expiresAt: i.expires_at,
        attempts: i.attempts,
        invitedBy: personOut(people.get(i.invited_by), i.invited_by)?.name ?? "Unknown",
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/invites/:id — withdraw one before it is used. */
router.delete("/invites/:id", async (req, res, next) => {
  try {
    const { data: invite } = await db
      .from("admin_invites")
      .select("id, email, accepted_at")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!invite) return res.status(404).json({ error: "No such invitation." });

    if (invite.accepted_at) {
      return res.status(400).json({
        error:
          "That invitation has already been used. Remove the administrator " +
          "instead.",
      });
    }

    // Expired rather than deleted: an invitation that was sent and then
    // withdrawn is worth being able to see afterwards.
    const { error } = await db
      .from("admin_invites")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", invite.id);

    if (error) throw error;

    await record(req.user.id, "admin.invite_withdrawn", null, invite.email);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
