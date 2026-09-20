// One definition of the vehicles this app knows about, shared by the
// signup form, the prompt for existing accounts, and the live ride map.
// They have to agree: the vehicle a rider watches move on the map is the
// same choice the driver made at signup. The drawings themselves live in
// `vehicleIcons.js`, keyed on the values below.

export const VEHICLES = [
  { value: "none", title: "No vehicle", note: "I'll find rides" },
  { value: "bike", title: "Bike", note: "I can offer rides" },
  { value: "scooty", title: "Scooty", note: "I can offer rides" },
  { value: "car", title: "Car", note: "I can offer rides" },
];

/**
 * Number plates vary by state and people write them a dozen ways. Match
 * the server's normalisation so a plate typed with odd spacing is not
 * rejected for it.
 */
export function normalisePlate(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/** The reason a plate is unusable, or null if it is fine. */
export function plateProblem(plate) {
  if (plate.length < 4) return "Enter your vehicle number so riders can spot you.";
  if (plate.length > 16) return "That vehicle number looks too long.";

  if (!/^[A-Z0-9][A-Z0-9 -]*[A-Z0-9]$/.test(plate)) {
    return "A vehicle number can only contain letters, digits, spaces and hyphens.";
  }

  return null;
}

/** Match the server's normalisation so odd punctuation is not rejected. */
export function normalisePhone(raw) {
  return String(raw || "").trim().replace(/[^\d+]/g, "");
}

/** The reason a phone number is unusable, or null if it is fine. */
export function phoneProblem(phone) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length < 7) return "Enter a phone number your ride can reach you on.";
  if (digits.length > 15) return "That phone number looks too long.";

  if (!/^\+?\d+$/.test(phone)) {
    return "A phone number can only contain digits, and may start with +.";
  }

  return null;
}

/**
 * Whether this account still owes us vehicle details.
 *
 * Two cases: an account from before the question existed (vehicle never
 * set), and a driver whose plate was never recorded. Both leave a rider
 * with no way to identify the vehicle at the kerb.
 */
export function needsVehicleDetails(user) {
  if (!user) return false;
  if (user.vehicle == null) return true;
  return user.vehicle !== "none" && !user.vehicleNumber;
}

/**
 * Whether this account still owes us a phone number.
 *
 * Everyone needs one, driver or not — a rider waiting at the wrong gate
 * has to be reachable just as much as the driver looking for them.
 */
export function needsPhone(user) {
  return Boolean(user) && !user.phone;
}

/** Anything at all missing from this profile. */
export function needsDetails(user) {
  return needsVehicleDetails(user) || needsPhone(user);
}
