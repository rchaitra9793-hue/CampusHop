const crypto = require("crypto");
const config = require("./config");

/**
 * Signed one-click links for the Accept / Decline buttons in an email.
 *
 * The driver reading a notification is not signed in — that is the whole
 * point of sending it — so the link itself has to carry the authority to
 * act. It is an HMAC over the request id, the action, and an expiry, so
 * it cannot be guessed, cannot be edited into a different decision, and
 * cannot be pointed at somebody else's request.
 *
 * A token is not a session. It permits exactly one answer to exactly one
 * request, and nothing else in the API accepts it.
 */

const SEPARATOR = ".";

function payloadOf(requestId, action, expiresAt) {
  return `${requestId}${SEPARATOR}${action}${SEPARATOR}${expiresAt}`;
}

function sign(payload) {
  return crypto
    .createHmac("sha256", config.actionSecret)
    .update(payload)
    .digest("base64url");
}

/** A token authorising one answer to one request, valid for `days`. */
function createActionToken(requestId, action, days = 7) {
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = payloadOf(requestId, action, expiresAt);

  return `${payload}${SEPARATOR}${sign(payload)}`;
}

/**
 * Returns { requestId, action } for a token that is intact and current,
 * or null for anything else. Never throws on malformed input — this is
 * reached straight from a URL anybody can type.
 */
function readActionToken(token) {
  if (typeof token !== "string") return null;

  const parts = token.split(SEPARATOR);

  if (parts.length !== 4) return null;

  const [requestId, action, expiresAt, signature] = parts;

  if (!["accepted", "declined"].includes(action)) return null;

  const expected = sign(payloadOf(requestId, action, expiresAt));

  // Constant-time, so a wrong signature cannot be narrowed down by
  // measuring how long the comparison took.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  if (!Number(expiresAt) || Date.now() > Number(expiresAt)) return null;

  return { requestId, action };
}

module.exports = { createActionToken, readActionToken };
