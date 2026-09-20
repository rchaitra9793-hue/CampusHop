// When a ride is over.
//
// A ride is worth showing until the moment it leaves, and not one minute
// longer: a seat in a car that has already gone is not a seat. The board
// therefore ends at the departure the driver chose, and this module is the
// single place that decides when that has passed.
//
// The database answers the same question (see db/008_ride_expiry.sql, which
// stores the departure as a real instant and indexes it), and the query in
// routes/rides.js uses that index. This file exists for two reasons anyway:
//
//   * so the rule still holds on a database where 008 has not been run yet,
//     and on rows written before it was, and
//   * so nothing depends on a derived column being correct to stay safe.
//
// Cheap either way — it is arithmetic on rows already fetched.

const config = require("./config");

/**
 * The campus's wall clock.
 *
 * `date` and `time` are what the driver typed, and what they typed is
 * local: an 8am departure means 8am where they are standing. Turning that
 * into an instant needs a zone, and a single-campus app is the rare case
 * where one fixed answer is the honest one.
 *
 * It must match campushop_timezone() in the migration — the two are asking
 * the same question and disagreeing would put a ride on the board for an
 * hour after it left, or take it off an hour early.
 */
function usableZone(zone) {
  if (!zone) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    console.warn(
      `  CAMPUS_TIMEZONE "${zone}" is not a zone this system knows.\n` +
        "  Falling back to the server's own clock, which is only right if\n" +
        "  the server and the campus share a timezone."
    );
    return null;
  }
}

const ZONE = usableZone(config.campusTimezone);

const PARTS = ZONE
  ? new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  : null;

/** How far the given zone was from UTC at a particular instant. */
function offsetAt(instantMs) {
  if (!PARTS) return -new Date(instantMs).getTimezoneOffset() * 60000;

  const parts = PARTS.formatToParts(new Date(instantMs));
  const value = (type) => Number(parts.find((p) => p.type === type)?.value);

  // Some platforms render midnight as hour 24.
  const hour = value("hour") % 24;

  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    hour,
    value("minute"),
    value("second")
  );

  return asIfUtc - instantMs;
}

/**
 * A wall-clock reading in the campus's zone -> an instant.
 *
 * Twice, because the offset itself depends on the instant: the first pass
 * uses the offset near the right answer, the second uses the offset at it.
 * India has no daylight saving, so the second pass changes nothing there —
 * it is what keeps this correct for a campus that does.
 */
function instantOfWallClock(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);

  let instant = naive - offsetAt(naive);
  instant = naive - offsetAt(instant);

  return instant;
}

/**
 * The moment a ride leaves, in epoch milliseconds, or null if its date
 * cannot be read.
 *
 * `departs_at` is the database's own answer and is preferred when present.
 * The date/time fallback is what covers a database where the migration has
 * not been run.
 */
function departureInstant(row) {
  if (!row) return null;

  if (row.departs_at) {
    const stored = Date.parse(row.departs_at);
    if (!Number.isNaN(stored)) return stored;
  }

  if (!row.date) return null;

  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(row.date));
  if (!day) return null;

  // A ride with no time is treated as good until the end of its day, so a
  // half-filled row is never dropped early.
  const clock = /^(\d{1,2}):(\d{2})/.exec(String(row.time || "23:59"));
  if (!clock) return null;

  const hour = Number(clock[1]);
  const minute = Number(clock[2]);

  if (hour > 23 || minute > 59) return null;

  return instantOfWallClock(
    Number(day[1]),
    Number(day[2]),
    Number(day[3]),
    hour,
    minute
  );
}

/** The same instant as an ISO string, for the client. */
function departureIso(row) {
  const at = departureInstant(row);
  return at == null ? null : new Date(at).toISOString();
}

/**
 * Has this ride left?
 *
 * A ride whose date cannot be read counts as not departed. Showing one
 * puzzling row is a smaller failure than silently swallowing a real ride
 * because of a stray value in a column.
 */
function departed(row, graceMs = 0) {
  const at = departureInstant(row);

  if (at == null) return false;

  return at + graceMs < Date.now();
}

/** Only the rides that have not left yet. */
function stillUpcoming(rows) {
  return (rows || []).filter((row) => !departed(row));
}

module.exports = {
  zone: ZONE,
  departureInstant,
  departureIso,
  departed,
  stillUpcoming,
};
