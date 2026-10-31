/**
 * The one rule for who may use CampusHop: an institutional address ending
 * in `.edu.in`. The client checks the same thing for a quick answer, but
 * this is the copy that counts — anybody can call Supabase Auth directly
 * with the public key, so the browser's check proves nothing.
 */
const CAMPUS_EMAIL = /^[^\s@]+@[^\s@]+\.edu\.in$/i;

function isCampusEmail(email) {
  return CAMPUS_EMAIL.test(String(email || "").trim());
}

/** Supabase sets one of these once the address has been confirmed. */
function isEmailConfirmed(authUser) {
  return Boolean(authUser?.email_confirmed_at || authUser?.confirmed_at);
}

module.exports = { isCampusEmail, isEmailConfirmed };
