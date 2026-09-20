// Clearing out rides that are over.
//
// Taking a ride off the board and deleting it are two different jobs, and
// this is the second one. The board is filtered on every read, so nothing
// here is what makes an expired ride disappear — by the time a row reaches
// this sweep, no rider has been able to see it for hours. What this does is
// stop the table growing forever with rides nothing ever happened on.
//
// Which is also why it is so much more cautious than the board filter. It
// removes a ride only when both are true:
//
//   * it left more than the grace period ago, and
//   * nobody ever asked for a seat on it.
//
// Only the rides nothing ever happened on, in other words. One request is
// enough to keep a ride forever, whatever became of it: an accepted one is
// a trip somebody took, a declined one is the rider's record of asking, an
// unanswered one is what the driver's queue shows as missed — and all
// three read the ride row for where the trip was going. Deleting it would
// not tidy the table, it would blank out screens still in use.
//
// The rules live in SQL (delete_expired_rides, in db/008_ride_expiry.sql)
// so they hold even when this server is not running. The JavaScript below
// is the same three conditions, used only on a database where 008 has not
// been run yet.

const { db } = require("./db");
const config = require("./config");
const { departed } = require("./expiry");

/** Postgres error codes for "you are asking about something that is not there". */
const MISSING = new Set([
  "42883", // undefined_function — the migration has not been run
  "42P01", // undefined_table
  "PGRST202", // PostgREST could not find the function in its schema cache
]);

function isMissing(error) {
  return Boolean(error) && (MISSING.has(error.code) || /find the function/i.test(error.message || ""));
}

// Said once, not on every tick.
let warnedAboutMigration = false;
let warnedAboutPermission = false;

/**
 * The fallback: the same rules, from here.
 *
 * Two reads and one write, over a table that is small by construction —
 * one campus, and rides older than the grace period only.
 */
async function sweepInJavaScript(graceMs) {
  const { data: rides, error } = await db
    .from("rides")
    .select("id, date, time, departs_at");

  if (error) throw error;

  // How far along the trip got is not part of this. The grace period is
  // what protects a trip in progress; hours after departure, a ride nobody
  // ever requested has no passenger left to protect.
  const expired = (rides || []).filter((ride) => departed(ride, graceMs));

  if (expired.length === 0) return 0;

  const ids = expired.map((r) => r.id);

  // A single request of any status makes this ride somebody's record.
  const { data: asked, error: askedError } = await db
    .from("trip_requests")
    .select("ride_id")
    .in("ride_id", ids);

  if (askedError) throw askedError;

  const spokenFor = new Set((asked || []).map((r) => r.ride_id));
  const doomed = ids.filter((id) => !spokenFor.has(id));

  if (doomed.length === 0) return 0;

  // Asking for the deleted rows back is what makes the count honest.
  // Without the service-role key this delete is subject to row-level
  // security, which refuses it by returning nothing rather than by
  // failing — so a sweep that removed none of them would otherwise report
  // that it had removed them all.
  const { data: gone, error: rideError } = await db
    .from("rides")
    .delete()
    .in("id", doomed)
    .select("id");

  if (rideError) throw rideError;

  const removed = gone?.length || 0;

  if (removed === 0 && !warnedAboutPermission) {
    warnedAboutPermission = true;

    console.warn(
      `\n  ${doomed.length} expired ride${doomed.length === 1 ? " is" : "s are"} ready to be cleared, ` +
        "but the database\n" +
        "  refused the delete. Riders cannot see them either way — the board\n" +
        "  is filtered — but to actually remove them, run db/008_ride_expiry.sql\n" +
        "  (its sweeper runs as the owner) or set SUPABASE_SERVICE_ROLE_KEY.\n"
    );
  }

  return removed;
}

/**
 * Run the sweep once. Returns how many rides were removed.
 *
 * Never throws: a cleanup job is not worth failing a request or stopping a
 * server over, and the next tick will try again.
 */
async function sweepExpiredRides() {
  const graceMinutes = Math.max(config.rideGraceMinutes, 0);

  try {
    const { data, error } = await db.rpc("delete_expired_rides", {
      grace_minutes: graceMinutes,
    });

    if (!error) return Number(data) || 0;

    if (!isMissing(error)) throw error;

    if (!warnedAboutMigration) {
      warnedAboutMigration = true;

      console.warn(
        "\n  db/008_ride_expiry.sql has not been run on this database.\n" +
          "  Expired rides are being filtered and swept by the API server\n" +
          "  instead, which works — but run it so the rule lives in the\n" +
          "  database too, and so the board can use the index.\n"
      );
    }

    return await sweepInJavaScript(graceMinutes * 60000);
  } catch (err) {
    console.warn(`  Expired-ride sweep failed: ${err.message}`);
    return 0;
  }
}

/**
 * Sweep on boot and then on a timer.
 *
 * On boot because the interesting case is a server that was off overnight,
 * by which time every ride posted for yesterday is over. The timer is
 * unref'd so this never holds the process open by itself.
 */
function startRideSweeper() {
  const run = async () => {
    const removed = await sweepExpiredRides();

    if (removed > 0) {
      console.log(`  Swept ${removed} expired ride${removed === 1 ? "" : "s"}.`);
    }
  };

  run();

  const timer = setInterval(run, Math.max(config.rideSweepMinutes, 1) * 60000);

  timer.unref?.();

  return () => clearInterval(timer);
}

module.exports = { sweepExpiredRides, startRideSweeper };
