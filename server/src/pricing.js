// What a seat costs, worked out here and nowhere else.
//
// The driver does not set this, and there is no column to store it in: a
// fare is derived from the route the server measured when the ride was
// posted. That is the whole point. A driver who can name their own price
// can undercut, overcharge, or quietly turn a campus lift into a business,
// and a rider comparing two rides down the same road has to work out which
// of them is being reasonable. Deriving it means every ride of the same
// length in the same class of vehicle costs the same, and the number on
// the board cannot be argued with by either side.
//
// It is deliberately a *contribution to running costs*, not a fare. These
// rates sit well under what an auto or a bike taxi charges for the same
// distance, because the driver was making this trip anyway — the rider is
// sharing the cost of a journey that was already happening, not buying a
// service. Pricing it like a taxi would change what this app is, both to
// the people using it and to anyone asking whether it needs a permit.

// What the journey costs to make, at roughly 2026 Bengaluru prices —
// petrol was ₹110.93/litre when these were last checked.
//
//   two-wheeler  ~45 km/l -> ₹2.50/km fuel, ~₹1.00/km tyres and service,
//                            ~₹1.75/km depreciation and insurance
//   small car    ~16 km/l -> ₹6.90/km fuel, ~₹2.50/km wear,
//                            ~₹7.00/km depreciation and insurance
//
// The rates below are round numbers at or under those totals, which is
// what keeps this expense-sharing rather than a fare. Karnataka's
// transport department draws exactly that line — a private vehicle
// sharing costs is one thing, a private vehicle running as a taxi is
// another — and a rate that cannot exceed what the trip actually costs
// is the side of it this app is on.
//
// Kept as a comment rather than as code because they are the
// justification for the numbers, not an input to them — recomputing a
// fare from today's fuel price would make yesterday's ride cost
// something different today.

// Per kilometre of the *journey*, not per person. This is the number
// that gets divided.
const RATE_CARD = {
  two_wheeler: {
    label: "Bike or scooty",
    vehicles: ["bike", "scooty"],
    perKm: 6,

    // Per person, and deliberately low. It exists for the trip too short
    // for distance to mean anything — a driver still went out of their
    // way and waited at a kerb, which no per-km rate captures. Set much
    // higher it would swallow the whole 2-8 km range this board runs on,
    // and then every ride would silently cost the same.
    minimum: 10,
  },

  car: {
    label: "Car",
    vehicles: ["car"],
    perKm: 10,
    minimum: 15,
  },
};

// The driver and the one rider. The cost of the journey is split down
// the middle: the driver was making the trip and paying for all of it,
// and the rider takes half of what it cost rather than buying a seat at
// a price somebody set.
const SHARED_BETWEEN = 2;

// Rounded to the rupee. It used to round to ₹5, on the reasoning that a
// fare should be payable in cash without hunting for change — but on a
// board where trips run 2-8 km that rounding, on top of the minimum,
// flattened nearly every two-wheeler ride to the same number and left
// the per-km rate doing no work at all. Distance is the thing being
// shared here, so distance has to show up in the price.
const ROUND_TO = 1;

/**
 * Which rate applies to a vehicle.
 *
 * A bike and a scooty are one class: they cost the same to run and carry
 * the same one pillion, and splitting them would only invite a driver to
 * relabel their vehicle for a better rate.
 */
function classFor(vehicle) {
  const key = String(vehicle || "").toLowerCase();

  for (const [name, rate] of Object.entries(RATE_CARD)) {
    if (rate.vehicles.includes(key)) return name;
  }

  // An unrecognised or missing vehicle takes the cheaper class. A guess
  // that overcharges is worse than one that does not.
  return "two_wheeler";
}

/**
 * What one person pays, in whole rupees.
 *
 * The journey has a cost; this is half of it. Null when the distance is
 * unknown — rides posted before routes were stored have no measured
 * length, and inventing one would put a number on screen that nothing
 * stands behind.
 */
function fareFor(vehicle, distanceMeters) {
  const metres = Number(distanceMeters);

  if (!Number.isFinite(metres) || metres <= 0) return null;

  const rate = RATE_CARD[classFor(vehicle)];
  const km = metres / 1000;

  const share = (rate.perKm * km) / SHARED_BETWEEN;
  const rounded = Math.round(share / ROUND_TO) * ROUND_TO;

  return Math.max(rate.minimum, rounded);
}

/**
 * The fare plus the reasoning, so the app can show its working.
 *
 * A price nobody can question is only fair if it can also be explained.
 *
 * `total` is what both people pay together rather than what the route
 * measured, so the two halves and the total always add up on screen. On
 * a trip short enough for the minimum to lift the share, that makes the
 * total slightly more than the journey strictly cost — `atMinimum` says
 * so, and a total that does not equal its own halves is a worse thing to
 * put in front of two people settling up.
 */
function fareDetail(vehicle, distanceMeters) {
  const amount = fareFor(vehicle, distanceMeters);

  if (amount == null) return null;

  const name = classFor(vehicle);
  const rate = RATE_CARD[name];

  return {
    amount,
    currency: "INR",

    // What the journey cost, and what each of the two people in the
    // vehicle carries of it.
    total: amount * SHARED_BETWEEN,
    splitBetween: SHARED_BETWEEN,

    // Per km of the journey, and per km of one person's half.
    perKm: rate.perKm,
    perKmEach: rate.perKm / SHARED_BETWEEN,

    minimum: rate.minimum,
    vehicleClass: name,
    classLabel: rate.label,

    // True when the distance alone would have come to less than the
    // floor, which is the one case where the per-km rate does not
    // explain the number on screen.
    atMinimum:
      amount === rate.minimum &&
      (rate.perKm * (distanceMeters / 1000)) / SHARED_BETWEEN < rate.minimum,
  };
}

/** The whole card, for explaining the scheme rather than one ride. */
function rateCard() {
  return Object.entries(RATE_CARD).map(([name, rate]) => ({
    vehicleClass: name,
    label: rate.label,
    perKm: rate.perKm,
    perKmEach: rate.perKm / SHARED_BETWEEN,
    minimum: rate.minimum,
    splitBetween: SHARED_BETWEEN,
  }));
}

module.exports = {
  fareFor,
  fareDetail,
  rateCard,
  RATE_CARD,
  ROUND_TO,
  SHARED_BETWEEN,
};
