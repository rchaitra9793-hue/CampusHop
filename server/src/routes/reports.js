const express = require("express");
const { db } = require("../db");
const { threadAccess } = require("./requests");

const router = express.Router();

// What can go wrong, in the words someone would actually use. Kept in step
// with the check constraint on the table — adding one here without adding
// it there is rejected by the database, which is the right way round.
const CATEGORIES = [
  "unsafe_driving",
  "no_show",
  "wrong_vehicle",
  "harassment",
  "payment",
  "other",
];

const DETAILS_MAX = 2000;

/**
 * Reporting a trip that went wrong.
 *
 * Either side can file: a rider left at a kerb and a driver who was stood
 * up are the same problem seen from two ends, and an app that only lets
 * one of them speak is telling the other their experience does not count.
 *
 * A report is about the *other* person on the trip, and the server works
 * out who that is. Letting the client name the subject would let anyone
 * file a report against anybody.
 */
router.post("/", async (req, res, next) => {
  try {
    const { requestId, category, details } = req.body || {};

    if (!CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ error: `category must be one of ${CATEGORIES.join(", ")}.` });
    }

    if (!requestId) {
      return res.status(400).json({ error: "Which trip is this about?" });
    }

    const text = String(details || "").trim();

    if (text.length > DETAILS_MAX) {
      return res
        .status(400)
        .json({ error: `Please keep it under ${DETAILS_MAX} characters.` });
    }

    // The same rule as a message thread: you may only report a trip you
    // were actually on. This is what stops the endpoint being a way to
    // file complaints about strangers.
    const access = await threadAccess(requestId, req.user.id);

    if (!access) return res.status(404).json({ error: "No such trip." });

    const { data, error } = await db
      .from("safety_reports")
      .insert({
        request_id: access.request.id,
        ride_id: access.ride.id,
        reporter_id: req.user.id,
        subject_id: access.otherId,
        category,
        details: text || null,
      })
      .select("id, category, status, created_at")
      .single();

    if (error) {
      // The unique index doing its job: the same complaint about the same
      // trip twice is one incident reported twice, not two incidents.
      if (error.code === "23505") {
        return res.status(409).json({
          error: "You've already reported this trip for that reason.",
        });
      }

      throw error;
    }

    res.status(201).json({
      report: {
        id: data.id,
        category: data.category,
        status: data.status,
        at: data.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/mine
 *
 * What this person has reported, and where each one got to. Someone who
 * took the trouble to report something is owed sight of it afterwards —
 * a report that vanishes on submission reads as a report nobody read.
 */
router.get("/mine", async (req, res, next) => {
  try {
    const { data: rows, error } = await db
      .from("safety_reports")
      .select("id, category, details, status, created_at, ride_id, request_id")
      .eq("reporter_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rideIds = [...new Set((rows || []).map((r) => r.ride_id).filter(Boolean))];

    const { data: rides } = rideIds.length
      ? await db.from("rides").select("id, pickup, dropoff, date").in("id", rideIds)
      : { data: [] };

    res.json({
      reports: (rows || []).map((r) => {
        const ride = rides?.find((x) => x.id === r.ride_id);

        return {
          id: r.id,
          category: r.category,
          details: r.details,
          status: r.status,
          at: r.created_at,
          tripId: r.request_id,

          // The trip may have been deleted since; the report outlives it,
          // so say so rather than rendering a blank row.
          pickup: ride?.pickup || null,
          dropoff: ride?.dropoff || null,
          date: ride?.date || null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/for/:requestId
 *
 * What this person has already filed about one trip, so the form can say
 * "reported" instead of offering to file it a second time.
 */
router.get("/for/:requestId", async (req, res, next) => {
  try {
    const { data, error } = await db
      .from("safety_reports")
      .select("id, category, status, created_at")
      .eq("reporter_id", req.user.id)
      .eq("request_id", req.params.requestId);

    if (error) throw error;

    res.json({ reports: data || [] });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, CATEGORIES };
