// Showing what a seat costs.
//
// The number itself is worked out on the server and arrives with the ride;
// nothing here calculates a fare. That matters — two copies of a pricing
// rule drift apart, and the copy in the browser is the one a determined
// person can edit.

/** "₹35". Null when the ride has no measured route to price. */
export function formatFare(fare) {
  if (!fare || fare.amount == null) return null;

  return `₹${fare.amount}`;
}

/** "₹40" — what the journey cost, both halves together. */
export function formatTotal(fare) {
  if (!fare || fare.total == null) return null;

  return `₹${fare.total}`;
}

/**
 * The one line that explains where the number came from.
 *
 * A price nobody is allowed to argue with has to be able to show its
 * working, or it just looks arbitrary. The working here is the split:
 * the journey cost this much per kilometre, and there are two people in
 * the vehicle.
 */
export function fareNote(fare) {
  if (!fare) return null;

  if (fare.atMinimum) {
    return `Minimum ₹${fare.minimum} each · ${fare.classLabel.toLowerCase()}`;
  }

  return `₹${fare.perKm}/km split two ways · ${fare.classLabel.toLowerCase()}`;
}

/**
 * What to actually do about it, in the words of whoever is reading.
 *
 * The driver has already paid for the whole journey — the petrol went in
 * before anyone got on — so settling up is the rider handing over their
 * half, not both people paying somebody. Saying "your share is ₹20" and
 * leaving it there is how two people end up staring at a screen working
 * out who owes whom.
 */
export function settleNote(fare, role) {
  if (!fare || fare.amount == null) return null;

  return role === "driver"
    ? `Collect ₹${fare.amount} — your own half is already spent on the trip.`
    : `Hand the driver ₹${fare.amount} — your half of what the journey cost.`;
}

/** Said wherever there is room for it, because it is the whole point. */
export const FARE_EXPLAINER =
  "Set by CampusHop from the distance and the vehicle — drivers cannot " +
  "change it. It is what the journey cost to make, split down the middle " +
  "between the two people in the vehicle, not a taxi fare.";
