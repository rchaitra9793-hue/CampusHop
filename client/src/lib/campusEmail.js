// Students and faculty sign in with an institutional address only. The
// server enforces the same rule; this copy just answers before a round
// trip.
const CAMPUS_EMAIL = /^[^\s@]+@[^\s@]+\.edu\.in$/i;

export const CAMPUS_EMAIL_ERROR =
  "Please use your college email address (must end with .edu.in).";

export function isCampusEmail(email) {
  return CAMPUS_EMAIL.test(String(email || "").trim());
}

/** Supabase sends a 6-digit code by default; projects can lengthen it. */
export function cleanCode(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 8);
}
