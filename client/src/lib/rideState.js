// What state a ride is in, from where the person looking at it stands.
//
// Shared by every place that shows a ride someone might ask for — the
// board, the nearby strip, a driver's queue — because the answers have to
// agree. A ride that reads "full" on one screen and "request" on another
// is a bug that looks like a feature to whoever finds it.

/**
 * The moment a ride leaves, in epoch milliseconds, or null if it cannot
 * be read.
 *
 * `departsAt` is the server's own answer, worked out in the campus's
 * timezone and sent with every ride. It is preferred over the date and
 * time strings because those are only a wall-clock reading, which a
 * browser set to another zone would resolve to a different instant —
 * and two screens disagreeing about whether a ride has gone is exactly
 * the bug this is here to prevent. The strings remain the fallback, for
 * rides that reach the browser from endpoints that do not send it.
 */
export function departureTime(ride) {
  if (ride?.departsAt) {
    const stored = Date.parse(ride.departsAt);
    if (!Number.isNaN(stored)) return stored;
  }

  if (!ride?.date) return null;

  // A ride with no time is good until the end of its day. Seconds are
  // trimmed so both "08:00" and "08:00:00" parse.
  const clock = String(ride.time || "23:59").slice(0, 5);

  const when = new Date(`${ride.date}T${clock}`);

  return Number.isNaN(when.getTime()) ? null : when.getTime();
}

/**
 * Whether a ride's departure has already passed.
 *
 * A request only matters until the ride leaves. After that nobody can
 * act on it usefully, so it stops standing in front of the driver rather
 * than nagging about a trip that has already gone.
 */
export function departed(ride) {
  const when = departureTime(ride);

  // An unparseable date is kept rather than hidden — losing a live
  // request is worse than showing a stale one.
  if (when == null) return false;

  return when < Date.now();
}

/**
 * The rides that have not left yet.
 *
 * The API already filters departed rides out of every board it returns,
 * so this is not what makes them disappear — it is what keeps them gone
 * between polls. A board fetched at 07:59 still holds an 08:00 ride at
 * 08:01, and the tab may have been sitting open across the whole of it.
 */
export function upcoming(rides) {
  return (rides || []).filter((ride) => !departed(ride));
}

/**
 * Which day the ride actually leaves.
 *
 * A bare departure time reads as "today" to anyone skimming the board,
 * so a ride posted for later in the week has to say so on the card
 * itself rather than only inside the details page.
 */
export function dayLabel(date) {
  if (!date) return null;

  const when = new Date(`${date}T00:00`);

  if (Number.isNaN(when.getTime())) return date;

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const days = Math.round((when.getTime() - midnight.getTime()) / 86400000);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";

  return when.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * What the request button is allowed to say and do.
 *
 * All of it comes from the server's view of this ride — whether you drive
 * it, whether you already asked, whether it is full. Deriving it here from
 * local state would lose the answer on every reload.
 */
export function requestState(ride, pending) {
  if (ride.isMine) {
    return { label: "This is your ride", disabled: true, tone: "own" };
  }

  if (pending) {
    return { label: "Sending…", disabled: true, tone: "sending" };
  }

  switch (ride.myRequestStatus) {
    case "pending":
      return { label: "Requested · waiting", disabled: true, tone: "pending" };
    case "accepted":
      return { label: "Accepted ✓", disabled: true, tone: "accepted" };
    case "declined":
      return { label: "Declined", disabled: true, tone: "declined" };
    default:
      break;
  }

  if (ride.full) {
    return { label: "Ride is full", disabled: true, tone: "full" };
  }

  return { label: "Request this ride", disabled: false, tone: "open" };
}
