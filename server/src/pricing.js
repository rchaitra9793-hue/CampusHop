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

// Running costs behind the rates below, at roughly 2026 Indian petrol
// prices. Kept here as a comment rather than as code because they are the
// justification for the numbers, not an input to them — recomputing a fare
// from fuel prices on every request would make yesterday's ride cost
// something different today.
//
//   petrol           ~ ₹105 / litre
//   two-wheeler      ~ 45 km/l  -> ₹2.3/km fuel, ~₹1.0/km tyres + service
//   small car        ~ 16 km/l  -> ₹6.6/km fuel, ~₹2.5/km wear
//
// The rider's share is roughly half the two-wheeler's running cost and
// roughly a third of the car's — the split you would reach if the people
// in the vehicle divided the cost between them.
const RATE_CARD = {
  two_wheeler: {
    label: "Bike or scooty",
    vehicles: ["bike", "scooty"],
    perKm: 2,
    minimum: 10,
  },

  car: {
    label: "Car",
    vehicles: ["car"],
    perKm: 3.5,
    minimum: 15,
  },
};

// Rounded to something payable in cash without anybody hunting for change.
const ROUND_TO = 5;

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
 * The rider's contribution for a ride, in whole rupees.
 *
 * Null when the distance is unknown — rides posted before routes were
 * stored have no measured length, and inventing one would put a number on
 * screen that nothing stands behind.
 */
function fareFor(vehicle, distanceMeters) {
  const metres = Number(distanceMeters);

  if (!Number.isFinite(metres) || metres <= 0) return null;

  const rate = RATE_CARD[classFor(vehicle)];
  const km = metres / 1000;

  const rounded = Math.round((rate.perKm * km) / ROUND_TO) * ROUND_TO;

  // The minimum covers the trips too short for a per-km rate to mean
  // anything: nobody starts an engine and rides across campus for ₹3.
  //
  // Kept low on purpose. Campus trips measured on this board run 2-8 km,
  // and a floor set much higher would bind on most of them — at which
  // point the per-km rate is decoration and every short ride silently
  // costs the same.
  return Math.max(rate.minimum, rounded);
}

/**
 * The fare plus the reasoning, so the app can show its working.
 *
 * A price nobody can question is only fair if it can also be explained.
 */
function fareDetail(vehicle, distanceMeters) {
  const amount = fareFor(vehicle, distanceMeters);

  if (amount == null) return null;

  const name = classFor(vehicle);
  const rate = RATE_CARD[name];

  return {
    amount,
    currency: "INR",
    perKm: rate.perKm,
    minimum: rate.minimum,
    vehicleClass: name,
    classLabel: rate.label,

    // True when the distance alone would have come to less than the floor,
    // which is the one case where the per-km rate does not explain the
    // number on screen.
    atMinimum: amount === rate.minimum && rate.perKm * (distanceMeters / 1000) < rate.minimum,
  };
}

/** The whole card, for explaining the scheme rather than one ride. */
function rateCard() {
  return Object.entries(RATE_CARD).map(([name, rate]) => ({
    vehicleClass: name,
    label: rate.label,
    perKm: rate.perKm,
    minimum: rate.minimum,
  }));
}

module.exports = { fareFor, fareDetail, rateCard, RATE_CARD, ROUND_TO };
