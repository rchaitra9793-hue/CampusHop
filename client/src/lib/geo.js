// Geo helpers for the browser.
//
// Address lookup and routing used to be called from here directly. They
// now go through the CampusHop API instead, so the OpenRouteService key
// stays on the server and route results can be cached across users.
//
// What remains client-side is what genuinely belongs here: reading the
// device's position, and formatting numbers for display.

import { api } from "./api";

/**
 * Address autocomplete. Returns [] rather than throwing so a flaky
 * network never blocks someone from typing.
 */
export async function searchPlaces(query, { signal, session } = {}) {
  if (!query || query.trim().length < 3) {
    return [];
  }

  try {
    return await api.geo.search(query, { signal, session });
  } catch (err) {
    // An aborted request is the normal case while typing, not a failure.
    if (err.name !== "AbortError") {
      console.error("Place search failed:", err.message);
    }
    return [];
  }
}

/**
 * Coordinates for a chosen suggestion.
 *
 * Suggestions deliberately arrive without them — that is what keeps
 * autocomplete cheap — so exactly one of these runs per place picked.
 * Unlike a search, a failure here matters: it means the pick did not
 * take, so it throws rather than returning nothing.
 */
export function resolvePlace(placeId, session) {
  return api.geo.resolve(placeId, session);
}

/**
 * Road route between two points, computed by the server.
 *
 * Throws with a message suitable for showing in a form.
 */
export function computeRoute(pickup, dropoff) {
  return api.geo.route(pickup, dropoff);
}

/** Turn coordinates back into a place name. Null if it cannot be named. */
export async function reverseGeocode(lat, lng) {
  try {
    return await api.geo.reverse(lat, lng);
  } catch (err) {
    console.error("Reverse geocode failed:", err.message);
    return null;
  }
}

/**
 * Current position from the browser, wrapped as a promise.
 *
 * Geolocation only works in a secure context — https, or localhost during
 * development. The messages here are written to be shown to the user.
 */
export function getCurrentLocation({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser does not support location access."));
      return;
    }

    if (!window.isSecureContext) {
      reject(
        new Error(
          "Location needs a secure connection. Use localhost or an https address."
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (err) => {
        const messages = {
          1: "Location permission was denied. Allow it in your browser to see nearby rides.",
          2: "Your location is unavailable right now.",
          3: "Finding your location took too long.",
        };
        reject(new Error(messages[err.code] || "Could not get your location."));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

export function formatDistance(meters) {
  if (meters == null) return null;
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds) {
  if (seconds == null) return null;

  const mins = Math.round(seconds / 60);

  if (mins < 60) return `${mins} min`;

  const hours = Math.floor(mins / 60);
  return `${hours} h ${mins % 60} min`;
}
