const { authClient, db } = require("./db");

// Validating a token costs a round trip to Supabase, so recently seen
// tokens are held briefly. Short enough that a sign-out takes effect
// quickly, long enough to keep a page of requests cheap.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function cacheGet(token) {
  const hit = cache.get(token);

  if (!hit) return null;

  if (Date.now() > hit.expires) {
    cache.delete(token);
    return null;
  }

  return hit.user;
}

/**
 * Rejects any request without a valid Supabase access token and attaches
 * the caller as req.user.
 *
 * This is the gate the old client-side code never had: the browser can
 * claim to be anyone, so identity is established here, from a signed
 * token, and never from the request body.
 */
async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Sign in to continue." });
  }

  const cached = cacheGet(token);

  if (cached) {
    req.user = cached;
    return next();
  }

  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: "Your session has expired. Sign in again." });
  }

  // Pull the profile so handlers have the display name and role without
  // trusting anything the client sent.
  const { data: profile } = await db
    .from("profiles")
    .select("name, role, pickup_point, vehicle, capacity, vehicle_number, phone")
    .eq("id", data.user.id)
    .maybeSingle();

  const user = {
    id: data.user.id,
    email: data.user.email,
    name: profile?.name || data.user.email?.split("@")[0] || "Rider",
    role: profile?.role || "student",
    pickupPoint: profile?.pickup_point ?? null,
    vehicle: profile?.vehicle ?? null,
    capacity: profile?.capacity ?? null,
    vehicleNumber: profile?.vehicle_number ?? null,
    phone: profile?.phone ?? null,
  };

  cache.set(token, { user, expires: Date.now() + CACHE_TTL_MS });

  req.user = user;
  next();
}

/** Drops a token from the cache, e.g. after a profile update. */
function invalidate(token) {
  if (token) cache.delete(token);
}

module.exports = { requireAuth, invalidate };
