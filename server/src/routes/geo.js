const express = require("express");
const { searchPlaces, resolvePlace, reverseGeocode, computeRoute } = require("../geo");

const router = express.Router();

/**
 * GET /api/geo/search?q=BTM+Layout&session=<token>
 *
 * Suggestions only — no coordinates. `session` groups the keystrokes of
 * one search with the resolve that follows, which is how autocomplete is
 * billed as a single act rather than per letter typed.
 */
router.get("/search", async (req, res, next) => {
  try {
    res.json({ places: await searchPlaces(req.query.q, req.query.session) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/geo/resolve?placeId=...&session=<token>
 *
 * Coordinates for the one suggestion the user actually picked.
 */
router.get("/resolve", async (req, res, next) => {
  try {
    res.json({ place: await resolvePlace(req.query.placeId, req.query.session) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/geo/reverse?lat=&lng= */
router.get("/reverse", async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng are required." });
    }

    res.json({ place: await reverseGeocode(lat, lng) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/geo/route
 *
 * Used to preview the rider's own route. The routing key lives on the
 * server, so it is never exposed to the browser.
 */
router.post("/route", async (req, res, next) => {
  try {
    const { pickup, dropoff, profile } = req.body || {};

    if (
      pickup?.lat == null ||
      pickup?.lng == null ||
      dropoff?.lat == null ||
      dropoff?.lng == null
    ) {
      return res.status(400).json({ error: "pickup and dropoff coordinates are required." });
    }

    res.json({ route: await computeRoute(pickup, dropoff, profile) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
