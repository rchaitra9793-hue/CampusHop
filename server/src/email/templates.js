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

module.exports = {
  requestReceived,
  requestAccepted,
  requestDeclined,
  requestCancelled,
};
