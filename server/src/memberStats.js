const { db } = require("./db");
const { ratingsFor } = require("./ratings");

// Lifetime numbers for a member — rides given, rides taken, km shared —
// and for the campus as a whole.
//
// They are counters, written once when a trip is completed, rather than
// counts worked out from the trips table: finished trips are deleted after
// a week, and a count read from them would quietly shrink.
//
// All of it needs db/014_payments_stats_reminders.sql. Before that has
// been run, every member reads as zero and nothing is written, rather than
// the board breaking over columns that do not exist yet.

let warned = false;

function missingColumns(error) {
  return (
    error &&
    (error.code === "42703" ||
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205" ||
      /rides_given|rides_taken|km_shared|stats_counted_at|campus_stats/i.test(error.message || ""))
  );
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    "\n  Member stats are off: run db/014_payments_stats_reminders.sql in the\n" +
      "  Supabase SQL editor to turn on rides given/taken, km shared and\n" +
      "  campus totals.\n"
  );
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Rides given, rides taken, km shared and rating, for a set of members.
 * Returns { [id]: { ridesGiven, ridesTaken, kmShared, rating, ratingCount } }.
 */
async function statsFor(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  if (!wanted.length) return {};

  const [{ data, error }, ratings] = await Promise.all([
    db.from("profiles").select("id, rides_given, rides_taken, km_shared, created_at").in("id", wanted),
    ratingsFor(wanted),
  ]);

  if (error && !missingColumns(error)) throw error;
  if (error) warnOnce();

  const rows = new Map((error ? [] : data || []).map((p) => [p.id, p]));
  const out = {};

  for (const id of wanted) {
    const p = rows.get(id);
    out[id] = {
      ridesGiven: p?.rides_given ?? 0,
      ridesTaken: p?.rides_taken ?? 0,
      kmShared: round1(p?.km_shared),
      memberSince: p?.created_at ?? null,
      rating: ratings[id]?.average ?? null,
      ratingCount: ratings[id]?.count ?? 0,
    };
  }

  return out;
}

async function bump(table, match, changes) {
  const { data: row, error } = await db.from(table).select(Object.keys(changes).join(", ")).match(match).maybeSingle();
  if (error) throw error;
  if (!row) return;

  const next = {};
  for (const [key, by] of Object.entries(changes)) next[key] = round1((Number(row[key]) || 0) + by);

  const { error: updateError } = await db.from(table).update(next).match(match);
  if (updateError) throw updateError;
}

/**
 * Count a completed trip into everyone's stats. Safe to call more than
 * once: the ride is claimed by setting stats_counted_at where it is still
 * empty, and only the call that wins the claim counts anything.
 */
async function countCompletedTrip(rideId) {
  const { data: claimed, error } = await db
    .from("rides")
    .update({ stats_counted_at: new Date().toISOString() })
    .eq("id", rideId)
    .is("stats_counted_at", null)
    .select("id, driver_id, distance_meters");

  if (missingColumns(error)) return warnOnce();
  if (error) throw error;

  const ride = claimed?.[0];
  if (!ride) return; // Already counted.

  const { data: riders } = await db
    .from("trip_requests")
    .select("rider_id")
    .eq("ride_id", ride.id)
    .eq("status", "accepted");

  const accepted = riders || [];

  // A trip nobody rode on is not a shared ride.
  if (!accepted.length) return;

  const km = round1((Number(ride.distance_meters) || 0) / 1000);

  await bump("profiles", { id: ride.driver_id }, { rides_given: 1, km_shared: km });

  for (const r of accepted) {
    await bump("profiles", { id: r.rider_id }, { rides_taken: 1, km_shared: km });
  }

  const { data: campus, error: campusError } = await db.from("campus_stats").select("id").eq("id", 1).maybeSingle();
  if (campusError && !missingColumns(campusError)) throw campusError;

  if (!campusError) {
    if (!campus) await db.from("campus_stats").insert({ id: 1 });
    await bump("campus_stats", { id: 1 }, { rides_completed: 1, km_travelled: km, riders_carried: accepted.length });
  }
}

/** The campus-wide numbers for the badge. */
async function campusTotals() {
  const [{ data: campus, error }, { count: members }, { data: rated }] = await Promise.all([
    db.from("campus_stats").select("rides_completed, km_travelled, riders_carried").eq("id", 1).maybeSingle(),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("trip_ratings").select("stars"),
  ]);

  if (error && !missingColumns(error)) throw error;
  if (error) warnOnce();

  const stars = (rated || []).map((r) => Number(r.stars)).filter(Number.isFinite);
  const happy = stars.filter((s) => s >= 4).length;

  return {
    ridesCompleted: campus?.rides_completed ?? 0,
    kmTravelled: round1(campus?.km_travelled),
    ridersCarried: campus?.riders_carried ?? 0,
    members: members ?? 0,
    happyRatings: happy,
    averageRating: stars.length ? round1(stars.reduce((a, b) => a + b, 0) / stars.length) : null,
    // Estimated: each shared seat is a car journey not made alone.
    co2SavedKg: round1((Number(campus?.km_travelled) || 0) * 0.12 * Math.max(1, (campus?.riders_carried || 0) / Math.max(1, campus?.rides_completed || 1))),
    available: !error,
  };
}

module.exports = { statsFor, countCompletedTrip, campusTotals, missingColumns };
