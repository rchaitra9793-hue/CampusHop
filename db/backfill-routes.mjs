// Backfill road routes onto rides that were posted before CampusHop
// stored coordinates.
//
//   node db/backfill-routes.mjs           # report only, changes nothing
//   node db/backfill-routes.mjs --apply   # geocode, route and save
//
// Safe to re-run: it only touches rows where route_geometry is null.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------- env

function readEnv() {
  const raw = readFileSync(join(here, "..", "client", ".env"), "utf8");
  const env = {};

  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].trim();
  }

  return env;
}

const env = readEnv();

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ORS_KEY = env.VITE_ORS_API_KEY;

// A service-role key bypasses row-level security. Without it we fall back
// to the anon key, which usually cannot update other people's rides.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const USING_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!SUPABASE_URL || !SUPABASE_KEY || !ORS_KEY) {
  console.error("Missing config. Check client/.env for the Supabase and ORS values.");
  process.exit(1);
}

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ services

// Photon asks callers to stay near 1 request/second on the public instance.
async function geocode(query) {
  const url =
    "https://photon.komoot.io/api/" +
    `?q=${encodeURIComponent(query)}&limit=1&lang=en&lat=12.9716&lon=77.5946`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);

  const data = await res.json();
  const feature = data.features?.[0];

  if (!feature) throw new Error(`no match for "${query}"`);

  const p = feature.properties;

  return {
    label: [p.name, p.suburb, p.city].filter(Boolean)[0] || query,
    lng: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
  };
}

async function route(from, to) {
  const res = await fetch(
    "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
    {
      method: "POST",
      headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ORS HTTP ${res.status} ${body.slice(0, 120)}`);
  }

  const data = await res.json();
  const feature = data.features?.[0];

  if (!feature) throw new Error("no drivable route");

  return {
    geometry: feature.geometry,
    distanceMeters: Math.round(feature.properties.summary.distance),
    durationSeconds: Math.round(feature.properties.summary.duration),
  };
}

// ---------------------------------------------------------------- main

const listRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rides` +
    "?select=id,pickup,dropoff,driver_name&route_geometry=is.null",
  { headers: sbHeaders }
);

const pending = await listRes.json();

if (!Array.isArray(pending)) {
  console.error("Could not read rides:", pending);
  process.exit(1);
}

if (pending.length === 0) {
  console.log("Every ride already has a route. Nothing to do.");
  process.exit(0);
}

console.log(`${pending.length} ride(s) missing a route.`);
console.log(APPLY ? "Mode: APPLY\n" : "Mode: dry run (pass --apply to save)\n");

let saved = 0;
let failed = 0;

for (const ride of pending) {
  const tag = `${ride.pickup} -> ${ride.dropoff}`;

  try {
    const from = await geocode(ride.pickup);
    await sleep(1100);

    const to = await geocode(ride.dropoff);
    await sleep(1100);

    const result = await route(from, to);

    const km = (result.distanceMeters / 1000).toFixed(1);
    const mins = Math.round(result.durationSeconds / 60);

    console.log(`  ${tag}`);
    console.log(`    ${from.label} -> ${to.label}  |  ${km} km, ${mins} min`);

    if (!APPLY) {
      continue;
    }

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/rides?id=eq.${ride.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        pickup_lat: from.lat,
        pickup_lng: from.lng,
        dropoff_lat: to.lat,
        dropoff_lng: to.lng,
        route_geometry: result.geometry,
        distance_meters: result.distanceMeters,
        duration_seconds: result.durationSeconds,
      }),
    });

    const updated = await patchRes.json();

    if (!patchRes.ok) {
      throw new Error(`Supabase HTTP ${patchRes.status}: ${JSON.stringify(updated)}`);
    }

    if (!Array.isArray(updated) || updated.length === 0) {
      throw new Error(
        "update affected 0 rows - row-level security is blocking it. " +
          "Re-run with SUPABASE_SERVICE_ROLE_KEY set."
      );
    }

    console.log("    saved");
    saved += 1;
  } catch (err) {
    console.log(`  ${tag}`);
    console.log(`    FAILED: ${err.message}`);
    failed += 1;
  }
}

console.log();

if (APPLY) {
  console.log(`Saved ${saved}, failed ${failed}.`);
  if (failed > 0 && !USING_SERVICE_KEY) {
    console.log(
      "If failures mention row-level security, get the service_role key from\n" +
        "Supabase -> Project Settings -> API, then re-run:\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=... node db/backfill-routes.mjs --apply"
    );
  }
} else {
  console.log("Dry run only. Re-run with --apply to save these routes.");
}
