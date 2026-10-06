import { supabase } from "../supabaseClient";

// Every read and write in the app goes through the CampusHop API. The
// browser no longer queries the database directly, so ownership rules,
// seat limits and route computation are all decided server-side.
//
// Supabase is still used in the client for one thing only: signing in,
// which yields the access token sent with each request below.
const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", body, params, signal } = {}) {
  const url = new URL(`${BASE}/api${path}`);

  // Drop empty values so the query string stays readable.
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  let res;

  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(await authHeader()),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // A cancelled request is normal while typing, not a failure.
    if (err.name === "AbortError") throw err;

    // A network-level failure here almost always means the API is down.
    throw new Error(
      `Cannot reach the CampusHop server at ${BASE}. Is it running? (npm run dev in server/)`
    );
  }

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(payload.error || `Request failed (${res.status}).`);
  }

  return payload;
}

export const api = {
  health: () => request("/health"),

  profile: {
    get: () => request("/profile").then((r) => r.user),
    create: (body) => request("/profile", { method: "POST", body }),
    update: (body) => request("/profile", { method: "PATCH", body }).then((r) => r.user),
  },

  rides: {
    /**
     * The search endpoint. Ranking is applied by the server, which
     * returns every ride; the client only renders what comes back.
     */
    list: (params) => request("/rides", { params }),
    get: (id) => request(`/rides/${id}`).then((r) => r.ride),
    create: (body) => request("/rides", { method: "POST", body }).then((r) => r.ride),
    remove: (id) => request(`/rides/${id}`, { method: "DELETE" }),

    // Live tracking. Only the driver writes a position; only the driver
    // and the riders they accepted can read one.
    reportLocation: (id, body) =>
      request(`/rides/${id}/location`, { method: "POST", body }),

    setTrip: (id, status) =>
      request(`/rides/${id}/trip`, { method: "POST", body: { status } }),

    live: (id) => request(`/rides/${id}/live`),
  },

  requests: {
    mine: () => request("/requests/mine").then((r) => r.trips),
    incoming: () => request("/requests/incoming").then((r) => r.requests),
    create: (rideId) => request("/requests", { method: "POST", body: { rideId } }),
    setStatus: (id, status) =>
      request(`/requests/${id}`, { method: "PATCH", body: { status } }),

    // Either side calling it off. Frees the seat and lets the rider ask
    // again later, which a "cancelled" status would not.
    cancel: (id) => request(`/requests/${id}`, { method: "DELETE" }),
  },

  // Talking to the person you are travelling with, without either of you
  // handing over a phone number. A thread exists only on an accepted
  // request, so only ever between two people already sharing a ride.
  messages: {
    list: (tripId) => request(`/requests/${tripId}/messages`),

    send: (tripId, body) =>
      request(`/requests/${tripId}/messages`, { method: "POST", body: { body } }),

    // One call for every thread, so a badge costs one request rather
    // than one per trip.
    unread: () => request("/requests/unread"),
  },

  // Reporting a trip that went wrong. Either side can file one, and the
  // server decides who it is about — the client never names a subject.
  reports: {
    create: (body) => request("/reports", { method: "POST", body }),
    mine: () => request("/reports/mine").then((r) => r.reports),
    forTrip: (tripId) => request(`/reports/for/${tripId}`).then((r) => r.reports),
  },

  // The operations dashboard that arrived as its own project. These are
  // its five calls, at the paths it already used — it is unchanged, so
  // this namespace keeps the name and the URLs it expects. Gated on the
  // server by ADMIN_EMAILS, which answers 403.
  admin: {
    overview: () => request("/admin/overview"),
    users: (q = "") => request("/admin/users", { params: { q } }).then((r) => r.users),
    reports: (status = "") =>
      request("/admin/reports", { params: { status } }).then((r) => r.reports),
    updateReport: (id, status) =>
      request(`/admin/reports/${id}`, { method: "PATCH", body: { status } }).then(
        (r) => r.report
      ),
    removeRide: (id) => request(`/admin/rides/${id}`, { method: "DELETE" }),
  },

  // The console built in this repo: profiles.is_admin, the audit log,
  // suspensions, report decisions and the invitation flow. Every one of
  // these answers 404 rather than 403 for a caller who is not an admin,
  // so a non-admin poking at them learns nothing about what is here.
  adminConsole: {
    overview: () => request("/admin-console/overview"),

    reports: (status, category) =>
      request("/admin-console/reports", { params: { status, category } }).then(
        (r) => r.reports
      ),

    setReportStatus: (id, status, note) =>
      request(`/admin-console/reports/${id}`, {
        method: "PATCH",
        body: { status, note },
      }).then((r) => r.report),

    users: (params) => request("/admin-console/users", { params }).then((r) => r.users),

    user: (id) => request(`/admin-console/users/${id}`),

    // The whole board, not only what has not left yet.
    rides: (params) => request("/admin-console/rides", { params }).then((r) => r.rides),

    removeRide: (id, reason) =>
      request(`/admin-console/rides/${id}`, { method: "DELETE", body: { reason } }),

    // Appointing an administrator by invitation, for somebody who has
    // never signed up or whose address is not on the campus domain. Two
    // steps: a code goes to the address, then the code comes back.
    invite: (email, reason) =>
      request("/admin-console/invites", { method: "POST", body: { email, reason } }),

    confirmInvite: (email, code) =>
      request("/admin-console/invites/verify", { method: "POST", body: { email, code } }),

    invites: () => request("/admin-console/invites").then((r) => r.invites),

    withdrawInvite: (id) =>
      request(`/admin-console/invites/${id}`, { method: "DELETE" }),

    // Granting and revoking administrator for an account already on the
    // board. Behind requireAdmin, so only somebody who already has the
    // privilege can hand it out.
    setRole: (id, isAdmin, reason) =>
      request(`/admin-console/users/${id}/role`, {
        method: "POST",
        body: { isAdmin, reason },
      }),

    suspend: (id, reason) =>
      request(`/admin-console/users/${id}/suspend`, { method: "POST", body: { reason } }),

    reinstate: (id, note) =>
      request(`/admin-console/users/${id}/reinstate`, { method: "POST", body: { note } }),

    // Returns the rows and the administrators who appear in them, so the
    // "by" filter does not need a second call.
    actions: (params) => request("/admin-console/actions", { params }),
  },

  // Rating the person you travelled with. Five stars and an optional
  // sentence, from each side about the other. The server decides who a
  // rating is about — the client never names a subject, the same rule
  // reports follow.
  ratings: {
    create: (body) => request("/ratings", { method: "POST", body }),

    // What the caller already put for one trip, so the form opens showing
    // it rather than blank.
    forTrip: (tripId) =>
      request(`/ratings/for/${tripId}`).then((r) => r.rating),

    // Your own standing, and what people said.
    mine: () => request("/ratings/mine"),
  },

  geo: {
    search: (q, { session, ...options } = {}) =>
      request("/geo/search", { params: { q, session }, ...options }).then((r) => r.places),

    // Suggestions carry no coordinates; this is the one call that does.
    resolve: (placeId, session) =>
      request("/geo/resolve", { params: { placeId, session } }).then((r) => r.place),
    reverse: (lat, lng) =>
      request("/geo/reverse", { params: { lat, lng } }).then((r) => r.place),
    route: (pickup, dropoff) =>
      request("/geo/route", { method: "POST", body: { pickup, dropoff } }).then(
        (r) => r.route
      ),
  },
};
