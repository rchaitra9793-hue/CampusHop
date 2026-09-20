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

/**
 * The one line that explains where the number came from.
 *
 * A price nobody is allowed to argue with has to be able to show its
 * working, or it just looks arbitrary.
 */
export function fareNote(fare) {
  if (!fare) return null;

  if (fare.atMinimum) {
    return `Minimum fare · ${fare.classLabel.toLowerCase()}`;
  }

  return `₹${fare.perKm}/km · ${fare.classLabel.toLowerCase()}`;
}

/** Said wherever there is room for it, because it is the whole point. */
export const FARE_EXPLAINER =
  "Set by CampusHop from the distance and the vehicle — drivers cannot " +
  "change it. It is a share of running costs, not a taxi fare.";
