const { authClient, db } = require("./db");
const { isAdmin: isPortalAdmin } = require("./admin");
const { isCampusEmail, isEmailConfirmed } = require("./campusEmail");

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

// The columns 009 adds. Asking for a column a database does not have
// fails the whole select, which would leave every signed-in user with no
// name, no vehicle and no phone until the migration was run — the app
// would look broken rather than merely un-migrated. So the first failure
// drops back to the pre-009 column list and says so, the same way
// routes/rides.js handles a database still waiting for 008.
const ADMIN_COLUMNS = "is_admin, suspended_at, suspended_reason";
const BASE_COLUMNS =
  "name, role, pickup_point, vehicle, capacity, vehicle_number, phone, course";

// Retried rather than latched off for good: 009 gets run while the server
// is up, and a permanent latch would leave administration dead until
// somebody thought to restart.
const ADMIN_RETRY_AFTER_MS = 60 * 1000;

let adminColumnsMissingSince = null;

function adminColumnsWorthTrying() {
  if (adminColumnsMissingSince == null) return true;

  if (Date.now() - adminColumnsMissingSince < ADMIN_RETRY_AFTER_MS) return false;

  adminColumnsMissingSince = null;
  return true;
}

async function fetchProfile(userId, authUser = {}) {
  const fullColumns = `${BASE_COLUMNS}, ${ADMIN_COLUMNS}`;
  const coreColumns = "name, role, pickup_point, vehicle, capacity";

  const read = (columns) =>
    db.from("profiles").select(columns).eq("id", userId).maybeSingle();

  // First try the complete profile shape. If an optional migration is not
  // installed yet, fall back to the original core profile rather than
  // treating the account as if it did not exist.
  if (adminColumnsWorthTrying()) {
    const { data, error } = await read(fullColumns);

    if (!error) {
      adminColumnsMissingSince = null;
      return data;
    }

    const missingColumn =
      error.code === "42703" ||
      /is_admin|suspended_at|suspended_reason|vehicle_number|phone|course/i.test(
        error.message || ""
      );

    if (!missingColumn) return null;

    if (adminColumnsMissingSince == null) {
      console.warn(
        "\n  Some optional CampusHop profile columns are missing.\n" +
          "  The app will keep working with the core profile until the\n" +
          "  database migrations are applied.\n"
      );
    }

    adminColumnsMissingSince = Date.now();
  }

  const { data: core, error: coreError } = await read(coreColumns);
  if (coreError) return null;

  if (!core) {
    // Auth succeeded but the public profile row does not exist. Create the
    // minimum valid profile now. PATCH /api/profile can then fill in the
    // phone/vehicle/course fields during profile setup.
    const { data: created, error: createError } = await db
      .from("profiles")
      .upsert(
        {
          id: userId,
          name:
            authUser.user_metadata?.name ||
            authUser.email?.split("@")[0] ||
            "Rider",
          role: authUser.user_metadata?.role === "faculty" ? "faculty" : "student",
          email: authUser.email || null,
        },
        { onConflict: "id" }
      )
      .select(coreColumns)
      .single();

    if (createError) {
      console.warn("Could not create missing profile row:", createError.message);
      return null;
    }

    return created;
  }

  return core;
}

/**
 * Why a student or faculty account may not use the app, or null if it may.
 *
 * Either kind of administrator is exempt: listed in ADMIN_EMAILS /
 * ADMIN_USER_IDS, or holding profiles.is_admin. The second is a plain
 * read, never an insert.
 */
async function studentFacultyProblem(authUser) {
  if (isCampusEmail(authUser.email) && isEmailConfirmed(authUser)) return null;

  if (isPortalAdmin({ id: authUser.id, email: authUser.email })) return null;

  const { data: row } = await db
    .from("profiles")
    .select("is_admin")
    .eq("id", authUser.id)
    .maybeSingle();

  if (row?.is_admin === true) return null;

  return isCampusEmail(authUser.email)
    ? "Verify your email address before signing in."
    : "CampusHop is only open to college email addresses ending in .edu.in.";
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
    if (refuseSuspended(cached, res)) return;

    req.user = cached;
    return next();
  }

  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: "Your session has expired. Sign in again." });
  }

  // Students and faculty get in only with a verified `.edu.in` address.
  // Administrators are appointed separately and may be on any domain, so
  // they are left out of this rule. Checked before fetchProfile, which
  // would otherwise create a profile row for an account that should not
  // exist.
  const campusProblem = await studentFacultyProblem(data.user);

  if (campusProblem) {
    return res.status(403).json({ error: campusProblem });
  }

  // Pull the profile so handlers have the display name and role without
  // trusting anything the client sent.
  const profile = await fetchProfile(data.user.id, data.user);

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
    course: profile?.course ?? null,

    // The privilege, read from the database and never from the request.
    // Deliberately not the `role` field above: that one is chosen by the
    // user on the signup form.
    isAdmin: profile?.is_admin === true,

    // Null for an account in good standing. Carried on req.user so a
    // handler can say why rather than just refusing.
    suspendedAt: profile?.suspended_at ?? null,
    suspendedReason: profile?.suspended_reason ?? null,
  };

  // The operations dashboard decides for itself who may open it, from
  // ADMIN_EMAILS rather than from any column here — src/admin.js arrived
  // with that project and is untouched. Carried on req.user so the client
  // knows which of the two screens to offer; the server still asks that
  // module again on every /api/admin call, so this flag grants nothing.
  user.isPortalAdmin = isPortalAdmin(user);

  cache.set(token, { user, expires: Date.now() + CACHE_TTL_MS });

  if (refuseSuspended(user, res)) return;

  req.user = user;
  next();
}

/**
 * Turns away a suspended account, and says why.
 *
 * Checked here rather than at sign-in so that suspending someone takes
 * effect while they are using the app — within the cache window above —
 * instead of whenever they next happen to sign in. Returns true when the
 * response has been sent.
 */
function refuseSuspended(user, res) {
  if (!user.suspendedAt) return false;

  res.status(403).json({
    error: user.suspendedReason
      ? `Your account has been suspended: ${user.suspendedReason}`
      : "Your account has been suspended. Contact the campus office.",
  });

  return true;
}

/**
 * Rejects anyone who is not an administrator. Mounted after requireAuth,
 * which is what establishes who the caller is.
 *
 * Answers 404 rather than 403 on purpose. A 403 confirms that the endpoint
 * exists and that the only thing missing is privilege, which is a map of
 * the admin surface handed to whoever went looking for it. To a user who
 * is not an admin, these routes simply are not there — the same answer the
 * catch-all in index.js gives for a path that was never defined.
 */
function requireAdmin(req, res, next) {
  // Strictly true, not merely truthy. requireAuth builds isAdmin from an
  // === comparison so it is always a real boolean, but a gate this
  // important should not depend on being called correctly.
  if (req.user?.isAdmin !== true) {
    return res
      .status(404)
      .json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
  }

  next();
}

/** Drops a token from the cache, e.g. after a profile update. */
function invalidate(token) {
  if (token) cache.delete(token);
}

/**
 * Drops every cached token belonging to one user.
 *
 * The cache is keyed by token, which is the right key for the lookup it
 * serves but the wrong one for "this account just changed". Suspending
 * somebody has to take hold now, not whenever their entry happens to
 * expire, so this walks the cache. It is a handful of entries and runs
 * only when an admin acts.
 */
function invalidateUser(userId) {
  if (!userId) return;

  for (const [token, hit] of cache) {
    if (hit.user?.id === userId) cache.delete(token);
  }
}

module.exports = { requireAuth, requireAdmin, invalidate, invalidateUser };
