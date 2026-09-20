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
