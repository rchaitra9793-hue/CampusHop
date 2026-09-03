// Route matching, moved server-side so ranking is decided by the API
// rather than by whatever the browser chooses to compute.
//
// Route matching for CampusHop.
//
// Every function here is local geometry over polylines already stored on
// the ride rows, so searching the board costs no API calls at all. Only
// the rider's own route (drawn on the map) needs one request.
//
// The weights mirror the "HOW WE SCORE" panel on the dashboard.

const WEIGHTS = {
  route: 0.35,
  time: 0.25,
  pickup: 0.2,
  reliability: 0.15,
  vehicle: 0.05,
};

// How far off before a component scores zero.
const PICKUP_TOLERANCE_M = 1500;
const DROPOFF_TOLERANCE_M = 1500;
const TIME_TOLERANCE_MIN = 45;

const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

// ------------------------------------------------------------- geometry

/**
 * Project lng/lat onto a local flat plane in metres.
 *
 * An equirectangular projection is plenty at city scale and keeps the
 * point-to-segment maths simple; over a few kilometres the error is
 * far below the tolerances above.
 */
function project([lng, lat], refLat) {
  return {
    x: lng * DEG * EARTH_RADIUS_M * Math.cos(refLat * DEG),
    y: lat * DEG * EARTH_RADIUS_M,
  };
}

function haversineMeters(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  // Degenerate segment: treat as a point.
  if (lengthSq === 0) {
    return { meters: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  }

  // Clamp the projection onto the segment.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const cx = a.x + t * dx;
  const cy = a.y + t * dy;

  return { meters: Math.hypot(p.x - cx, p.y - cy), t };
}

/**
 * Nearest approach of a point to a polyline.
 *
 * Returns the distance in metres and `progress` — how far along the
 * route that nearest point sits, as a 0..1 fraction. `progress` is what
 * lets us tell "on the way" from "in the opposite direction".
 */
function distanceToRoute(point, coordinates) {
  if (!coordinates || coordinates.length < 2) {
    return null;
  }

  const refLat = point.lat;
  const p = project([point.lng, point.lat], refLat);

  // Cumulative planar length, so progress reflects real distance rather
  // than vertex count (vertices bunch up around corners).
  const projected = coordinates.map((c) => project(c, refLat));

  const cumulative = [0];
  for (let i = 1; i < projected.length; i += 1) {
    const step = Math.hypot(
      projected[i].x - projected[i - 1].x,
      projected[i].y - projected[i - 1].y
    );
    cumulative.push(cumulative[i - 1] + step);
  }

  const total = cumulative[cumulative.length - 1] || 1;

  let best = { meters: Infinity, progress: 0 };

  for (let i = 0; i < projected.length - 1; i += 1) {
    const { meters, t } = segmentDistance(p, projected[i], projected[i + 1]);

    if (meters < best.meters) {
      const along = cumulative[i] + t * (cumulative[i + 1] - cumulative[i]);
      best = { meters, progress: along / total };
    }
  }

  return best;
}

// -------------------------------------------------------------- scoring

// Linear falloff from 1 (exact) to 0 (at or beyond the tolerance).
function decay(value, tolerance) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, 1 - value / tolerance));
}

/** "08:30" -> 510 minutes past midnight. */
function minutesOfDay(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;

  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  return h * 60 + m;
}

/**
 * Score one ride against what the rider asked for.
 *
 * `criteria` is { pickup, dropoff, arriveBy, vehicle } — every field
 * optional. Components with nothing to compare against are dropped and
 * the remaining weights are renormalised, so a partial search still
 * gives a meaningful ranking instead of silently scoring low.
 *
 * Returns null when the ride has no stored route to compare against.
 */
function scoreRide(ride, criteria = {}) {
  const coordinates = ride.routeGeometry?.coordinates;

  if (!coordinates || coordinates.length < 2) {
    return null;
  }

  const parts = {};
  const detail = {};

  // --- route + pickup: geometry against the driver's actual road line
  if (criteria.pickup && criteria.dropoff) {
    const fromRoute = distanceToRoute(criteria.pickup, coordinates);
    const toRoute = distanceToRoute(criteria.dropoff, coordinates);

    if (fromRoute && toRoute) {
      // The rider must be picked up before being dropped off; if the
      // nearest points are in the wrong order along the route, the
      // driver is heading the other way.
      const rightDirection = fromRoute.progress < toRoute.progress;

      const overlap = Math.abs(toRoute.progress - fromRoute.progress);

      parts.route =
        decay(toRoute.meters, DROPOFF_TOLERANCE_M) *
        (rightDirection ? 1 : 0.15) *
        // Reward routes that cover a real stretch of the rider's trip.
        (0.55 + 0.45 * Math.min(1, overlap / 0.5));

      parts.pickup = decay(fromRoute.meters, PICKUP_TOLERANCE_M);

      detail.walkToPickupM = Math.round(fromRoute.meters);
      detail.walkFromDropoffM = Math.round(toRoute.meters);
      detail.rightDirection = rightDirection;
    }
  }

  // --- time: compare arrival, not departure
  const rideDeparture = minutesOfDay(ride.time);

  if (criteria.arriveBy != null && rideDeparture != null) {
    const travelMin = (ride.durationSeconds ?? 0) / 60;
    const rideArrival = rideDeparture + travelMin;
    const diff = Math.abs(rideArrival - criteria.arriveBy);

    parts.time = decay(diff, TIME_TOLERANCE_MIN);

    detail.arrivesAtMin = Math.round(rideArrival);
    detail.minutesOffM = Math.round(diff);
  }

  // --- reliability: real accepted-ride count, with a neutral baseline
  // so a brand-new driver is not punished into irrelevance.
  const completed = ride.completedRides ?? 0;
  parts.reliability = 0.5 + 0.5 * Math.min(1, completed / 5);
  detail.completedRides = completed;

  // --- vehicle preference
  if (criteria.vehicle && criteria.vehicle !== "any") {
    parts.vehicle = ride.vehicle?.toLowerCase() === criteria.vehicle ? 1 : 0;
  }

  // Renormalise over whichever components we could actually judge.
  let weighted = 0;
  let totalWeight = 0;

  for (const [key, value] of Object.entries(parts)) {
    weighted += value * WEIGHTS[key];
    totalWeight += WEIGHTS[key];
  }

  if (totalWeight === 0) {
    return null;
  }

  return {
    score: Math.round((weighted / totalWeight) * 100),
    parts,
    detail,
  };
}

/**
 * Score and sort a board of rides. Rides without a stored route keep a
 * null score and sink to the bottom rather than disappearing.
 */
function rankRides(rides, criteria) {
  const searching = Boolean(criteria?.pickup && criteria?.dropoff);

  const scored = rides.map((ride) => {
    const result = searching ? scoreRide(ride, criteria) : null;

    return {
      ...ride,
      score: result?.score ?? ride.score ?? null,
      matchParts: result?.parts ?? null,
      matchDetail: result?.detail ?? null,
      mappable: Boolean(ride.routeGeometry?.coordinates?.length),
    };
  });

  if (!searching) {
    return scored;
  }

  return scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

function formatClock(minutes) {
  if (minutes == null) return null;

  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;

  return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Default catchment for the "near me" filter. */
const NEARBY_RADIUS_M = 2000;

/**
 * How far a point is from a ride, in metres.
 *
 * Measured to the nearest point on the driver's actual road route rather
 * than to their starting pin — a driver passing your street is useful to
 * you even when they set off several kilometres away. Falls back to the
 * pickup coordinates for rides that predate stored geometry.
 */
function distanceToRide(point, ride) {
  const coordinates = ride.routeGeometry?.coordinates;

  if (coordinates?.length >= 2) {
    const nearest = distanceToRoute(point, coordinates);
    if (nearest) return nearest.meters;
  }

  if (ride.pickupLat != null && ride.pickupLng != null) {
    return haversineMeters(point, { lat: ride.pickupLat, lng: ride.pickupLng });
  }

  return null;
}

/**
 * Annotate rides with their distance from `point` and whether they fall
 * inside `radius`.
 *
 * Nothing is dropped here — the caller decides whether to hide the far
 * ones, so it can still report how many were filtered out.
 */
function withProximity(rides, point, radius = NEARBY_RADIUS_M) {
  if (!point) {
    return rides.map((ride) => ({ ...ride, distanceFromMe: null, nearby: true }));
  }

  return rides.map((ride) => {
    const meters = distanceToRide(point, ride);

    return {
      ...ride,
      distanceFromMe: meters,
      nearby: meters != null && meters <= radius,
    };
  });
}

module.exports = {
  WEIGHTS,
  NEARBY_RADIUS_M,
  haversineMeters,
  distanceToRoute,
  minutesOfDay,
  scoreRide,
  rankRides,
  formatClock,
  distanceToRide,
  withProximity,
};
