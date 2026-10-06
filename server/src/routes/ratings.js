const express = require("express");
const { db } = require("../db");
const { threadAccess } = require("./requests");
const { departed } = require("../expiry");
const { ratingsFor, myRatings } = require("../ratings");

const router = express.Router();

const COMMENT_MAX = 500;

/**
 * POST /api/ratings
 *
 * Rating the person you travelled with.
 *
 * The form never says who it is about. There are two people on a trip and
 * the server knows which one is rating, so naming the other would only be
 * a way to get it wrong — the same rule reports already follow.
 */
router.post("/", async (req, res, next) => {
  try {
    const { requestId, stars, comment } = req.body || {};

    if (!requestId) {
      return res.status(400).json({ error: "Which trip is this about?" });
    }

    const score = Number(stars);

    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ error: "A rating is one to five stars." });
    }

    const text = String(comment || "").trim();

    if (text.length > COMMENT_MAX) {
      return res
        .status(400)
        .json({ error: `Please keep it under ${COMMENT_MAX} characters.` });
    }

    // You may only rate a trip you were actually on. This is what stops
    // the endpoint being a way to score strangers.
    const access = await threadAccess(requestId, req.user.id);

    if (!access) return res.status(404).json({ error: "No such trip." });

    // And only a trip that was actually shared. A declined request means
    // the two of them never travelled together.
    if (access.request.status !== "accepted") {
      return res.status(400).json({
        error: "You can only rate a trip you shared.",
      });
    }

    // A trip is rateable once it is over. Rating one before it has
    // happened would be rating an intention.
    const { data: ride } = await db
      .from("rides")
      .select("id, trip_status, date, time, departs_at")
      .eq("id", access.ride.id)
      .maybeSingle();

    const finished = ride?.trip_status === "completed" || departed(ride || {});

    if (!finished) {
      return res.status(400).json({
        error: "Wait until the trip is over, then rate it.",
      });
    }

    // Changing your mind is an edit of the one rating, not a second one.
    // The unique index in 010 says the same thing from the database's end.
    const { data, error } = await db
      .from("trip_ratings")
      .upsert(
        {
          request_id: access.request.id,
          ride_id: access.ride.id,
          rater_id: req.user.id,
          subject_id: access.otherId,
          stars: score,
          comment: text || null,
        },
        {
          // No space after the comma: this goes into the on_conflict
          // query parameter verbatim, and PostgREST splits it on the
          // comma — a space would ask it for a column called " request_id".
          onConflict: "rater_id,request_id",
        }
      )
      .select("id, stars, comment, created_at")
      .single();

    if (error) {
      // The view and the table both live in 010.
      if (error.code === "42P01") {
        return res.status(503).json({
          error: "Ratings are not set up on this database yet.",
        });
      }

      throw error;
    }

    res.status(201).json({
      rating: {
        id: data.id,
        stars: data.stars,
        comment: data.comment,
        at: data.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ratings/for/:requestId
 *
 * What the caller already put for one trip, so the form opens showing it
 * rather than blank.
 */
router.get("/for/:requestId", async (req, res, next) => {
  try {
    const mine = await myRatings(req.user.id, [req.params.requestId]);

    res.json({ rating: mine[req.params.requestId] || null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ratings/mine
 *
 * The caller's own standing, and what was said. Somebody being scored by
 * strangers is owed sight of the result.
 *
 * Comments come back without a name attached. A four-star rating with
 * "waited ten minutes at the gate" is useful; knowing which of last
 * week's three riders wrote it turns a rating into a thing to settle.
 */
router.get("/mine", async (req, res, next) => {
  try {
    const summary = await ratingsFor([req.user.id]);

    const { data: received } = await db
      .from("trip_ratings")
      .select("id, stars, comment, created_at")
      .eq("subject_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    res.json({
      average: summary[req.user.id]?.average ?? null,
      count: summary[req.user.id]?.count ?? 0,

      received: (received || []).map((r) => ({
        id: r.id,
        stars: r.stars,
        comment: r.comment,
        at: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
