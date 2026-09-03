const config = require("./config");

// Place search and pin-naming run on Google; routing stays on
// OpenRouteService.
//
// That split is deliberate. The matcher scores the whole ride board
// against route geometry stored on each row, which is what makes
// searching cost nothing — and Google's terms do not allow route
// responses to be stored that way. ORS does, so the routes stay there
// and Google does the two jobs it is genuinely better at: finding an
// Indian address from three letters, and naming a dropped pin.
//
// Both Google calls are made from here rather than the browser, so the
// key with quota attached never ships to a client.
const PLACES_URL = "https://places.googleapis.com/v1";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const ORS_URL = "https://api.openrouteservice.org/v2/directions";

// Bias searches toward the campus city so local places rank first.
// Overridable, since the only thing tying this to Bengaluru is a guess
// about where the campus is.
const CITY_LAT = Number(process.env.CITY_LAT) || 12.9716;
const CITY_LON = Number(process.env.CITY_LON) || 77.5946;

// How far out a search still counts as "around here". A bias, not a
// fence: a student searching for their home town still finds it.
const SEARCH_RADIUS_KM = Number(process.env.SEARCH_RADIUS_KM) || 250;

// Identical routes get requested constantly (a rider re-running a search,
// several riders on the same corridor). Caching them keeps us far inside
// the free daily quota.
const routeCache = new Map();
const ROUTE_CACHE_MAX = 500;

const KM_PER_DEGREE = 111.32;

function requireKey() {
  if (!config.googleMapsKey) {
    throw Object.assign(
      new Error("Place search is not configured on the server."),
      { status: 500 }
    );
  }

  return config.googleMapsKey;
}

/** Google's error bodies are more useful to us than to the user. */
function upstreamFailure(body, fallback) {
  const message = body?.error?.message || body?.error_message;

  if (message) console.error("Google Maps error:", message);

  return Object.assign(new Error(fallback), { status: 502 });
}

// The place types worth naming on a ride-sharing board. Google returns a
// long list per place; the first one we recognise wins.
const PLACE_KINDS = {
  university: "university",
  school: "school",
  hospital: "hospital",
  bus_station: "bus station",
  transit_station: "station",
  train_station: "railway station",
  subway_station: "metro",
  light_rail_station: "metro",
  airport: "airport",
  shopping_mall: "mall",
  park: "park",
  restaurant: "restaurant",
  cafe: "cafe",
  lodging: "hotel",
  premise: "building",
  street_address: "address",
  route: "road",
  sublocality: "area",
  sublocality_level_1: "area",
  neighborhood: "neighbourhood",
  locality: "city",
};

function kindOf(types) {
  for (const type of types || []) {
    if (PLACE_KINDS[type]) return PLACE_KINDS[type];
  }

  return null;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const DEG = Math.PI / 180;
  const dLat = (bLat - aLat) * DEG;
  const dLng = (bLng - aLng) * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Address autocomplete.
 *
 * Predictions carry no coordinates — that is what keeps autocomplete
 * cheap. The chosen one is resolved separately, by `resolvePlace`, so a
 * rider who types twelve characters costs one lookup rather than twelve.
 *
 * `sessionToken` ties the two calls together for billing. It comes from
 * the client, which knows when one act of "picking a place" begins and
 * ends; the server cannot tell a new search from a corrected keystroke.
 */
async function searchPlaces(query, sessionToken) {
  if (!query || query.trim().length < 3) return [];

  const res = await fetch(`${PLACES_URL}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": requireKey(),
    },
    body: JSON.stringify({
      input: query,
      // A bias rather than a restriction, so "Delhi" still resolves.
      locationBias: {
        circle: {
          center: { latitude: CITY_LAT, longitude: CITY_LON },
          radius: Math.min(SEARCH_RADIUS_KM, 50) * 1000,
        },
      },
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });

  if (!res.ok) {
    throw upstreamFailure(await res.json().catch(() => null), "Place search is unavailable.");
  }

  const data = await res.json();

  return (data.suggestions || [])
    .filter((s) => s.placePrediction)
    .map(({ placePrediction: p }) => ({
      placeId: p.placeId,

      // Google already separates the name from its address trail, which
      // is exactly the split the suggestion list wants.
      label: p.structuredFormat?.mainText?.text || p.text?.text || "Unnamed place",
      context: p.structuredFormat?.secondaryText?.text || "",

      kind: kindOf(p.types),

      // Coordinates arrive with resolvePlace, once one is chosen.
      lat: null,
      lng: null,
    }));
}

/**
 * Turn a chosen prediction into coordinates.
 *
 * Called once, when a suggestion is picked — never while typing.
 */
async function resolvePlace(placeId, sessionToken) {
  if (!placeId) {
    throw Object.assign(new Error("placeId is required."), { status: 400 });
  }

  const url =
    `${PLACES_URL}/places/${encodeURIComponent(placeId)}` +
    (sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "");

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": requireKey(),
      "X-Goog-FieldMask": "id,displayName,formattedAddress,shortFormattedAddress,location,types",
    },
  });

  if (!res.ok) {
    throw upstreamFailure(
      await res.json().catch(() => null),
      "Could not pin down that place."
    );
  }

  const place = await res.json();

  if (!place.location) {
    throw Object.assign(new Error("That place has no location on file."), { status: 422 });
  }

  const label = place.displayName?.text || place.shortFormattedAddress || "Unnamed place";

  // Drop the name from the front of the address when Google has repeated
  // it, so the context line adds something instead of echoing.
  const address = place.shortFormattedAddress || place.formattedAddress || "";
  const context = address.startsWith(label)
    ? address.slice(label.length).replace(/^[,\s]+/, "")
    : address;

  return {
    placeId: place.id,
    label,
    context,
    kind: kindOf(place.types),
    lat: place.location.latitude,
    lng: place.location.longitude,
  };
}

// Naming a pin is the same question asked over and over — a map picker
// re-asks it on every small pan. Rounding to ~11 m makes those the same
// key, which keeps the call volume (and the bill) down.
const reverseCache = new Map();
const REVERSE_CACHE_MAX = 500;

const reverseKey = (lat, lng) => `${lat.toFixed(4)}:${lng.toFixed(4)}`;

// A Plus Code is a compressed coordinate — "WHR8+95V". It is a correct
// answer to "what is here" and a useless one to "where should I stand",
// and Google leads with one whenever a point has no street number. It
// arrives inside the address text rather than in the result's types, so
// it has to be recognised by shape.
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

const isPlusCode = (part) => PLUS_CODE.test(String(part || "").trim());

/** Address text split into parts, with any leading Plus Code dropped. */
function addressParts(formatted) {
  const parts = String(formatted || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return parts.filter((part) => !isPlusCode(part));
}

/**
 * Name the spot under a dropped pin.
 *
 * A pin is a coordinate, and a coordinate on its own tells a rider
 * nothing about where to wait. Google is asked what is at that point, the
 * most specific real answer is taken, and the pin is described in
 * relation to it: on it, or near it.
 *
 * The returned lat/lng are always the pin's own. The name describes the
 * spot; it does not move it.
 */
async function reverseGeocode(lat, lng) {
  const key = reverseKey(lat, lng);

  if (reverseCache.has(key)) {
    return reverseCache.get(key);
  }

  const res = await fetch(
    `${GEOCODE_URL}?latlng=${lat},${lng}&key=${requireKey()}&language=en`
  );

  if (!res.ok) return null;

  const data = await res.json();

  if (data.status !== "OK" || !data.results?.length) {
    // ZERO_RESULTS is a real answer; anything else is worth knowing about.
    if (data.status !== "ZERO_RESULTS") {
      console.error("Reverse geocode failed:", data.status, data.error_message || "");
    }

    return null;
  }

  // Google orders most-specific first, but the leading result is often
  // only a Plus Code dressed as an address. Prefer one that actually
  // names somewhere, and fall back to the nearest thing that does.
  const scored = data.results
    .map((r) => ({ result: r, parts: addressParts(r.formatted_address) }))
    .filter((r) => r.parts.length > 0);

  // A result whose first part is a name or a street beats one that opens
  // on a locality — "246, Bapuji Nagar" over "Bengaluru".
  const named = scored.find((r) =>
    (r.result.types || []).some((t) =>
      ["premise", "subpremise", "establishment", "point_of_interest", "street_address"].includes(t)
    )
  );

  const chosen = named || scored[0];

  if (!chosen) return null;

  const best = chosen.result;
  const parts = chosen.parts;

  // A bare house number is not a place. "1100" means nothing to someone
  // walking to a kerb; "1100, 23rd A Cross Rd" does, so the number keeps
  // the street it belongs to.
  const justANumber = /^[\d/\-]+$/.test(parts[0] || "");
  const take = justANumber && parts.length > 1 ? 2 : 1;

  const label = parts.slice(0, take).join(", ") || "Dropped pin";
  const context = parts.slice(take, take + 3).join(", ");

  const at = best.geometry?.location;
  const metres = at ? Math.round(haversineKm(lat, lng, at.lat, at.lng) * 1000) : 0;

  // Under ~40 m the pin is effectively on the place, so it takes the name
  // outright. Beyond that, "near" is the honest label — the rider is being
  // told where to stand, not sold a false address.
  const onIt = metres <= 40;

  const result = {
    label: onIt ? label : `Near ${label}`,
    context,

    // The pin, not the landmark.
    lat,
    lng,

    kind: kindOf(best.types),
    placeId: best.place_id || null,
    approximate: !onIt,
    metresAway: metres,
  };

  if (reverseCache.size >= REVERSE_CACHE_MAX) {
    reverseCache.delete(reverseCache.keys().next().value);
  }

  reverseCache.set(key, result);

  return result;
}

/**
 * Road route between two points, via OpenRouteService.
 *
 * Coordinates go to ORS as [lng, lat], the reverse of the order used
 * everywhere else in this codebase.
 */
async function computeRoute(pickup, dropoff, profile = "driving-car") {
  if (!config.orsKey) {
    throw Object.assign(new Error("Routing is not configured on the server."), {
      status: 500,
    });
  }

  const key = [
    profile,
    pickup.lat.toFixed(5),
    pickup.lng.toFixed(5),
    dropoff.lat.toFixed(5),
    dropoff.lng.toFixed(5),
  ].join(":");

  if (routeCache.has(key)) {
    return routeCache.get(key);
  }

  const res = await fetch(`${ORS_URL}/${profile}/geojson`, {
    method: "POST",
    headers: {
      Authorization: config.orsKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates: [
        [pickup.lng, pickup.lat],
        [dropoff.lng, dropoff.lat],
      ],
    }),
  });

  if (res.status === 429) {
    throw Object.assign(new Error("Daily routing limit reached. Try again tomorrow."), {
      status: 429,
    });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);

    throw Object.assign(
      new Error(body?.error?.message || "Could not find a road route between those points."),
      { status: 422 }
    );
  }

  const data = await res.json();
  const feature = data.features?.[0];

  if (!feature) {
    throw Object.assign(new Error("No drivable route found between those points."), {
      status: 422,
    });
  }

  const result = {
    geometry: feature.geometry,
    distanceMeters: Math.round(feature.properties.summary.distance),
    durationSeconds: Math.round(feature.properties.summary.duration),
  };

  // Simple bounded cache: drop the oldest entry once full.
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    routeCache.delete(routeCache.keys().next().value);
  }

  routeCache.set(key, result);

  return result;
}

module.exports = { searchPlaces, resolvePlace, reverseGeocode, computeRoute };
