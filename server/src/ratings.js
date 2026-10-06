const { db } = require("./db");

// Reading the view fails on a database still waiting for 010. The board
// should not stop working over a missing average, so a failure turns
// ratings off and says so rather than throwing.
//
// But not for good. Somebody runs the migration while the server is up —
// that is the normal case, not the odd one — and a latch that never
// retries means ratings stay dead until the process happens to be
// restarted, with nothing on screen saying why. So the "off" state
// expires, and the next read after that tries again.
//
// The window is long enough that a database genuinely without 010 is
// asked once a minute rather than once a request, and short enough that
// running the migration takes effect while somebody is still looking at
// the page they ran it for.
const RETRY_AFTER_MS = 60 * 1000;

let missingSince = null;

/** True when a read should be attempted. */
function worthTrying() {
  if (missingSince == null) return true;

  if (Date.now() - missingSince < RETRY_AFTER_MS) return false;

  // The window has passed; let the next read find out.
  missingSince = null;
  return true;
}

/**
 * The average and the count, for a set of people.
 *
 * Reads the view 010 adds, which aggregates in the database rather than
 * pulling every rating into this process to average in JavaScript. One
 * query for the whole board.
 *
 * Returns {} rather than throwing on a database without 010, so a ride
 * card simply has no stars on it.
 *
 * This lives outside routes/ on purpose: the ride board, the trip list and
 * the ratings endpoints all need it, and routes/ratings.js already depends
 * on routes/requests.js for threadAccess. Putting it here is what keeps
 * that from becoming a cycle.
 */
async function ratingsFor(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];

  if (!wanted.length || !worthTrying()) return {};

  const { data, error } = await db
    .from("profile_ratings")
    .select("subject_id, rating_avg, rating_count")
    .in("subject_id", wanted);

  if (error) {
    // 42P01 is "no such relation": the migration has not been run here.
    const missing =
      error.code === "42P01" ||
      error.code === "42703" ||
      /profile_ratings/i.test(error.message || "");

    if (!missing) throw error;

    // Only said once per window, so a database without 010 does not fill
    // the log with one copy per board read.
    if (missingSince == null) {
      console.warn(
        "\n  db/010_ratings.sql has not been run on this database.\n" +
          "  Everything works, but nobody can be rated and no ride card\n" +
          "  shows stars. Run the migration — this is checked again in a\n" +
          "  minute, so no restart is needed afterwards.\n"
      );
    }

    missingSince = Date.now();

    return {};
  }

  missingSince = null;

  const out = {};

  for (const row of data || []) {
    out[row.subject_id] = {
      // Postgres hands back a numeric as a string.
      average: Number(row.rating_avg),
      count: row.rating_count,
    };
  }

  return out;
}

/**
 * The caller's own ratings, keyed by the trip they were about.
 *
 * What the client needs in order to say "rated" instead of offering the
 * form a second time, and to show somebody what they put last time.
 */
async function myRatings(userId, requestIds) {
  const wanted = [...new Set((requestIds || []).filter(Boolean))];

  if (!wanted.length || !worthTrying()) return {};

  const { data, error } = await db
    .from("trip_ratings")
    .select("request_id, stars, comment")
    .eq("rater_id", userId)
    .in("request_id", wanted);

  // A missing table is already reported by ratingsFor above; this one
  // simply has nothing to say about it.
  if (error) return {};

  const out = {};

  for (const row of data || []) {
    out[row.request_id] = { stars: row.stars, comment: row.comment };
  }

  return out;
}

module.exports = { ratingsFor, myRatings };
