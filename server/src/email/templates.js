const { COLORS, esc, button, detailRow, layout } = require("./theme");

// Shared bits ---------------------------------------------------------

const P = `font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.62;color:${COLORS.ink};margin:0 0 16px;`;
const H1 = `font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:23px;line-height:1.3;font-weight:800;color:${COLORS.ink};margin:0 0 14px;letter-spacing:-0.02em;`;
const QUIET = `font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${COLORS.muted};margin:18px 0 0;`;

/** The pickup to drop-off pair, which is the thing people actually read. */
function routeBlock(pickup, dropoff) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background:${COLORS.paper};border:1px solid ${COLORS.line};border-radius:14px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.14em;color:${COLORS.muted};text-transform:uppercase;">Pickup</div>
          <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:${COLORS.ink};margin-top:3px;">${esc(pickup || "—")}</div>

          <div style="font-size:15px;color:${COLORS.muted};margin:9px 0 7px;">&#8595;</div>

          <div style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.14em;color:${COLORS.muted};text-transform:uppercase;">Drop-off</div>
          <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:${COLORS.ink};margin-top:3px;">${esc(dropoff || "—")}</div>
        </td>
      </tr>
    </table>`;
}

function detailsTable(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
      ${rows.join("")}
    </table>`;
}

function askedAt(iso) {
  if (!iso) return null;

  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Templates -----------------------------------------------------------

/**
 * A rider has asked for a seat. Goes to the driver.
 *
 * The two buttons answer it outright: the driver is not signed in while
 * reading their email, and making them find the app to press Accept is
 * exactly the friction that leaves a rider waiting.
 */
function requestReceived({
  driverName,
  riderName,
  ride,
  createdAt,
  acceptUrl,
  declineUrl,
  boardUrl,
}) {
  const body = `
    <h1 style="${H1}">${esc(riderName)} wants a seat.</h1>

    <p style="${P}">
      Hi ${esc(driverName)} — someone has asked to join your ride. Answer
      straight from here, or open CampusHop if you would rather look first.
    </p>

    ${routeBlock(ride?.pickup, ride?.dropoff)}

    ${detailsTable([
      detailRow("Passenger", riderName),
      detailRow("Date", ride?.date),
      detailRow("Departs", ride?.time),
      detailRow(
        "Seats left",
        ride?.seatsLeft != null ? `${ride.seatsLeft} of ${ride.seats}` : null
      ),
      detailRow("Asked at", askedAt(createdAt)),
    ])}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:0 10px 10px 0;">
          ${button(acceptUrl, "Accept request", { background: COLORS.sage })}
        </td>
        <td style="padding:0 0 10px 0;">
          ${button(declineUrl, "Decline", {
            background: COLORS.card,
            color: COLORS.ink,
            border: COLORS.line,
          })}
        </td>
      </tr>
    </table>

    <p style="${QUIET}">
      These buttons work once and expire in 7 days. Prefer the app?
      <a href="${esc(boardUrl)}" style="color:${COLORS.lavenderInk};font-weight:600;">Open CampusHop</a>.
    </p>`;

  return {
    subject: `${riderName} wants a seat — ${ride?.pickup || "your ride"} at ${
      ride?.time || ""
    }`.trim(),
    html: layout({
      title: "New ride request",
      preheader: `${riderName} asked for a seat on your ${ride?.time || ""} ride.`,
      bannerColor: COLORS.coral,
      bannerText: "New ride request",
      body,
    }),
    text: [
      `${riderName} wants a seat on your ride.`,
      ``,
      `${ride?.pickup} -> ${ride?.dropoff}`,
      `${ride?.date} at ${ride?.time}`,
      ``,
      `Accept:  ${acceptUrl}`,
      `Decline: ${declineUrl}`,
    ].join("\n"),
  };
}

/** The driver said yes. Goes to the rider. */
function requestAccepted({
  riderName,
  driverName,
  ride,
  driverPhone,
  vehicleNumber,
  tripUrl,
}) {
  const body = `
    <h1 style="${H1}">You have got a seat.</h1>

    <p style="${P}">
      Hi ${esc(riderName)} — ${esc(driverName)} accepted your request.
      Here is what to look for at the kerb.
    </p>

    ${routeBlock(ride?.pickup, ride?.dropoff)}

    ${detailsTable([
      detailRow("Driver", driverName),
      detailRow("Date", ride?.date),
      detailRow("Departs", ride?.time),
      detailRow("Vehicle", ride?.vehicle),
      detailRow("Number plate", vehicleNumber),
      detailRow("Phone", driverPhone),
    ])}

    ${button(tripUrl, "View the trip", { background: COLORS.sage })}

    <p style="${QUIET}">
      Be at the pickup a couple of minutes early — the driver can see
      where you are once the trip starts.
    </p>`;

  return {
    subject: `Accepted — your seat with ${driverName} on ${ride?.date || ""}`.trim(),
    html: layout({
      title: "Request accepted",
      preheader: `${driverName} accepted your request for the ${
        ride?.time || ""
      } ride.`,
      bannerColor: COLORS.sageLight,
      bannerText: "Request accepted",
      body,
    }),
    text: [
      `${driverName} accepted your request.`,
      ``,
      `${ride?.pickup} -> ${ride?.dropoff}`,
      `${ride?.date} at ${ride?.time}`,
      vehicleNumber ? `Look for: ${vehicleNumber}` : ``,
      ``,
      tripUrl,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** The driver said no. Goes to the rider. */
function requestDeclined({ riderName, driverName, ride, findUrl }) {
  const body = `
    <h1 style="${H1}">That one is not available.</h1>

    <p style="${P}">
      Hi ${esc(riderName)} — ${esc(driverName)} could not take you on the
      ${esc(ride?.time || "")} ride. Worth checking the board: other
      drivers on your route post most mornings.
    </p>

    ${detailsTable([
      detailRow("Driver", driverName),
      detailRow(
        "Route",
        ride?.pickup && ride?.dropoff ? `${ride.pickup} → ${ride.dropoff}` : null
      ),
      detailRow("Date", ride?.date),
      detailRow("Departs", ride?.time),
    ])}

    ${button(findUrl, "Find another ride", {
      background: COLORS.coral,
      color: COLORS.ink,
    })}`;

  return {
    subject: `Not this time — ${driverName} declined your request`,
    html: layout({
      title: "Request declined",
      preheader: `${driverName} declined your request for the ${
        ride?.time || ""
      } ride.`,
      bannerColor: COLORS.lavenderLight,
      bannerText: "Request declined",
      body,
    }),
    text: [
      `${driverName} declined your request for the ${ride?.date} ${ride?.time} ride.`,
      ``,
      `Find another: ${findUrl}`,
    ].join("\n"),
  };
}

/**
 * A confirmed seat was called off, by either side. Goes to the other
 * person — the one who would otherwise be waiting at the kerb.
 */
function requestCancelled({ toName, byName, byRole, ride, findUrl }) {
  const headline =
    byRole === "driver"
      ? "Your ride has been called off."
      : `${byName} has dropped out.`;

  const explain =
    byRole === "driver"
      ? `${esc(byName)} cancelled the ride you had a seat on. You will need to make another plan for this trip.`
      : `${esc(byName)} cancelled their seat, so you have one free again on this ride.`;

  const body = `
    <h1 style="${H1}">${esc(headline)}</h1>

    <p style="${P}">Hi ${esc(toName)} — ${explain}</p>

    ${detailsTable([
      detailRow(
        "Route",
        ride?.pickup && ride?.dropoff ? `${ride.pickup} → ${ride.dropoff}` : null
      ),
      detailRow("Date", ride?.date),
      detailRow("Departs", ride?.time),
      detailRow("Cancelled by", byName),
    ])}

    ${button(findUrl, byRole === "driver" ? "Find another ride" : "Open CampusHop", {
      background: COLORS.coral,
      color: COLORS.ink,
    })}`;

  return {
    subject:
      byRole === "driver"
        ? `Cancelled — the ${ride?.time || ""} ride with ${byName}`.trim()
        : `${byName} cancelled their seat on your ${ride?.time || ""} ride`.trim(),
    html: layout({
      title: "Booking cancelled",
      preheader: `${byName} cancelled the ${ride?.time || ""} ride booking.`,
      bannerColor: COLORS.lavenderLight,
      bannerText: "Booking cancelled",
      body,
    }),
    text: [
      headline,
      ``,
      `${ride?.pickup} -> ${ride?.dropoff}`,
      `${ride?.date} at ${ride?.time}`,
      ``,
      findUrl,
    ].join("\n"),
  };
}


/**
 * Somebody has been proposed as an administrator.
 *
 * The code is the consent. An administrator typed this address into a box;
 * nothing has happened yet, and nothing will until whoever reads this
 * mailbox reads the code back. So the mail has to say three things very
 * plainly: who proposed you, what it would let you do, and that ignoring
 * it is a complete answer.
 */
function adminInvite({ code, invitedBy, reason, minutes, appUrl }) {
  const body = `
    <h1 style="${H1}">You have been proposed as an administrator.</h1>

    <p style="${P}">
      ${esc(invitedBy)} would like to make this address an administrator of
      CampusHop — the campus ride-sharing app.
    </p>

    ${
      reason
        ? `<p style="${P}"><em>&ldquo;${esc(reason)}&rdquo;</em></p>`
        : ""
    }

    <p style="${P}">
      To confirm, read this code back to ${esc(invitedBy)}:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
      <tr>
        <td align="center" style="padding:20px;background:${COLORS.paper};border:1px solid ${COLORS.line};border-radius:14px;">
          <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:0.22em;color:${COLORS.ink};">
            ${esc(code)}
          </div>
          <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${COLORS.muted};margin-top:8px;">
            expires in ${esc(String(minutes))} minutes
          </div>
        </td>
      </tr>
    </table>

    ${detailsTable([
      detailRow("An administrator can", "read safety reports filed about anybody"),
      detailRow("", "see and suspend any account on the campus"),
      detailRow("", "remove rides from the board"),
      detailRow("", "appoint and remove other administrators"),
    ])}

    <p style="${P}">
      Every one of those actions is written to an audit log with the name of
      the administrator who took it.
    </p>

    <p style="${QUIET}">
      <strong>If you were not expecting this, do nothing.</strong> The code
      is useless on its own — it only works when it is given back to the
      person who sent it — and it expires by itself. Nobody is appointed
      until that happens, and you can simply delete this message.
    </p>

    <p style="${QUIET}">
      Only share this code with the administrator who told you to expect
      it. Nobody at CampusHop will ever ask you for it by phone or chat.
    </p>`;

  return {
    subject: `Your CampusHop administrator code: ${code}`,
    html: layout({
      title: "Administrator invitation",
      preheader: `${invitedBy} has proposed this address as a CampusHop administrator.`,
      bannerColor: COLORS.coral,
      bannerText: "ADMINISTRATOR INVITATION",
      body,
    }),
    text:
      `${invitedBy} would like to make this address an administrator of CampusHop.\n\n` +
      `Your confirmation code is ${code}. It expires in ${minutes} minutes.\n\n` +
      `Read it back to ${invitedBy} to confirm.\n\n` +
      `An administrator can read safety reports, see and suspend any account, ` +
      `remove rides, and appoint other administrators. Every action is logged.\n\n` +
      `If you were not expecting this, do nothing — the code expires by itself ` +
      `and nobody is appointed. ${appUrl || ""}`.trim(),
  };
}


/**
 * The code came back, and the appointment went through.
 *
 * The invitation mail asked a question; this one answers it. Without it
 * the only person who ever learns the outcome is the administrator who
 * typed the code in — the new one read six digits down a phone and then
 * heard nothing, with no way to tell whether it worked, and no idea an
 * account now exists in their name.
 *
 * So this says three things: it went through, here is what you can now
 * do, and here is how to get in. The last one matters most for an account
 * created by the confirmation itself: nobody knows its password, not even
 * the administrator who appointed them, so the way in is the ordinary
 * reset link rather than a password sent by email.
 */
function adminAppointed({ name, invitedBy, reason, appUrl, needsPassword }) {
  const greeting = name ? `Hi ${esc(name)} — you` : "You";

  const body = `
    <h1 style="${H1}">You are now an administrator.</h1>

    <p style="${P}">
      ${greeting} have been appointed an administrator of CampusHop by
      ${esc(invitedBy)}. The code you read back is what confirmed it.
    </p>

    ${
      reason
        ? `<p style="${P}"><em>&ldquo;${esc(reason)}&rdquo;</em></p>`
        : ""
    }

    ${detailsTable([
      detailRow("You can now", "read safety reports filed about anybody"),
      detailRow("", "see and suspend any account on the campus"),
      detailRow("", "remove rides from the board"),
      detailRow("", "appoint and remove other administrators"),
    ])}

    ${
      needsPassword
        ? `<p style="${P}">
             <strong>Setting your password.</strong> An account was created
             for this address just now, and nobody knows its password —
             not even ${esc(invitedBy)}. Open CampusHop, choose
             <strong>Forgot password?</strong> on the sign-in page, and set
             one. The link comes back to this address.
           </p>`
        : `<p style="${P}">
             Sign in as you normally do. The administration screen is
             waiting on the other side.
           </p>`
    }

    ${button(appUrl, needsPassword ? "Set a password" : "Open CampusHop", {
      background: COLORS.sage,
    })}

    <p style="${QUIET}">
      Everything an administrator does here is written to an audit log with
      their name against it — including everything you do. That is there to
      protect you as much as anybody: a decision you made is a decision
      that can be shown to have been made for a reason.
    </p>

    <p style="${QUIET}">
      If you think this is a mistake, tell ${esc(invitedBy)}. Any other
      administrator can remove the privilege again.
    </p>`;

  return {
    subject: "You are now a CampusHop administrator",
    html: layout({
      title: "Administrator appointed",
      preheader: `${invitedBy} appointed you an administrator of CampusHop.`,
      bannerColor: COLORS.sageLight,
      bannerText: "ADMINISTRATOR APPOINTED",
      body,
    }),
    text:
      `You are now an administrator of CampusHop, appointed by ${invitedBy}.\n\n` +
      (reason ? `Reason given: ${reason}\n\n` : "") +
      `You can read safety reports, see and suspend accounts, remove rides, ` +
      `and appoint other administrators. Every action is written to an audit ` +
      `log with your name against it.\n\n` +
      (needsPassword
        ? `An account was created for this address just now and nobody knows ` +
          `its password. Open ${appUrl}, choose "Forgot password?", and set one.\n`
        : `Sign in as usual at ${appUrl}\n`),
  };
}

module.exports = {
  requestReceived,
  requestAccepted,
  requestDeclined,
  requestCancelled,
  adminInvite,
  adminAppointed,
};
