const nodemailer = require("nodemailer");

const config = require("../config");
const { db } = require("../db");
const { createActionToken } = require("../actionTokens");
const templates = require("./templates");

/**
 * Outgoing notifications.
 *
 * Nothing in here is allowed to affect whether an API call succeeds. A
 * request for a seat is the real work; telling somebody about it is a
 * courtesy that must never be the reason the seat could not be asked
 * for. Every send is therefore fire-and-forget and swallows its own
 * failures, and every caller is expected to not await it.
 */

const enabled = Boolean(config.smtpUser && config.smtpPass);

let transport = null;

if (enabled) {
  // An explicit host means a provider like Brevo or Resend; without one
  // this falls back to Gmail, whose settings nodemailer already knows.
  transport = nodemailer.createTransport(
    config.smtpHost
      ? {
          host: config.smtpHost,
          port: config.smtpPort,
          // 465 is implicit TLS; 587 upgrades with STARTTLS.
          secure: config.smtpPort === 465,
          auth: { user: config.smtpUser, pass: config.smtpPass },
        }
      : {
          service: "gmail",
          auth: { user: config.smtpUser, pass: config.smtpPass },
        }
  );

  console.log(
    `  Email notifications ON via ${config.smtpHost || "Gmail"} as ${config.smtpUser}`
  );
} else {
  console.warn(
    "\n  Email notifications are OFF (SMTP_USER / SMTP_PASS not set in server/.env).\n" +
      "  The app works exactly as before; nothing is sent.\n"
  );
}

/**
 * Look up where to write to.
 *
 * Addresses live on the profile because auth.users is not readable
 * without the service-role key. A profile written before the email
 * column existed simply has none, and is skipped rather than guessed at.
 */
async function addressFor(userId) {
  if (!userId) return null;

  const { data, error } = await db
    .from("profiles")
    .select("email, name")
    .eq("id", userId)
    .maybeSingle();

  // The column may not exist yet if 006 has not been run. That is a
  // setup state, not a crash.
  if (error) {
    console.warn("Email lookup failed:", error.message);
    return null;
  }

  return data?.email ? { email: data.email, name: data.name } : null;
}

/** The one place that actually talks to the mail server. */
async function deliver(to, { subject, html, text }) {
  if (!enabled || !to) return false;

  await transport.sendMail({
    from: `CampusHop <${config.smtpFrom}>`,
    to,
    subject,
    html,
    text,
  });

  console.log(`Emailed ${to}: ${subject}`);
  return true;
}

/**
 * Send without ever letting the caller fail.
 *
 * Callers deliberately do not await this: a slow SMTP handshake should
 * not sit in front of the rider's HTTP response.
 */
function send(to, message) {
  if (!enabled || !to) return;

  deliver(to, message).catch((err) =>
    console.error(`Email to ${to} failed:`, err.message)
  );
}

// The notifications themselves ----------------------------------------

/** A rider asked for a seat. Tells the driver, with one-click answers. */
async function notifyRequestReceived({ request, ride, driverId, riderName }) {
  if (!enabled) return;

  try {
    const to = await addressFor(driverId);
    if (!to) return;

    const link = (action) =>
      `${config.apiUrl}/api/requests/action?token=${encodeURIComponent(
        createActionToken(request.id, action)
      )}`;

    send(
      to.email,
      templates.requestReceived({
        driverName: to.name || "there",
        riderName,
        ride,
        createdAt: request.created_at,
        acceptUrl: link("accepted"),
        declineUrl: link("declined"),
        boardUrl: config.appUrl,
      })
    );
  } catch (err) {
    console.error("notifyRequestReceived failed:", err.message);
  }
}

/** The driver answered. Tells the rider either way. */
async function notifyRequestAnswered({ status, riderId, driver, ride }) {
  if (!enabled) return;

  try {
    const to = await addressFor(riderId);
    if (!to) return;

    const message =
      status === "accepted"
        ? templates.requestAccepted({
            riderName: to.name || "there",
            driverName: driver?.name || "Your driver",
            ride,
            driverPhone: driver?.phone,
            vehicleNumber: driver?.vehicle_number,
            tripUrl: config.appUrl,
          })
        : templates.requestDeclined({
            riderName: to.name || "there",
            driverName: driver?.name || "The driver",
            ride,
            findUrl: config.appUrl,
          });

    send(to.email, message);
  } catch (err) {
    console.error("notifyRequestAnswered failed:", err.message);
  }
}

/** Someone called off a confirmed seat. Tells the other party. */
async function notifyCancelled({ toUserId, byName, byRole, ride }) {
  if (!enabled) return;

  try {
    const to = await addressFor(toUserId);
    if (!to) return;

    send(
      to.email,
      templates.requestCancelled({
        toName: to.name || "there",
        byName: byName || "The other person",
        byRole,
        ride,
        findUrl: config.appUrl,
      })
    );
  } catch (err) {
    console.error("notifyCancelled failed:", err.message);
  }
}

module.exports = {
  enabled,
  notifyRequestReceived,
  notifyRequestAnswered,
  notifyCancelled,

  // Exposed for the preview script in db/.
  templates,
};
