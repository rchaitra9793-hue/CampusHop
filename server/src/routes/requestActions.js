const express = require("express");

const { db } = require("../db");
const config = require("../config");
const { readActionToken } = require("../actionTokens");
const { COLORS, esc } = require("../email/theme");
const notify = require("../email");

const router = express.Router();

/**
 * Answering a request straight from the notification email.
 *
 * This is the one part of the API that runs without a signed-in user,
 * because the driver reading their inbox is not signed in — that is the
 * whole reason the email was sent. The signed token in the link is the
 * authority: it names one request and one answer, it cannot be edited
 * without invalidating the signature, and it expires.
 *
 * GET only ever *asks*. Mail providers and corporate scanners follow
 * links in messages to check them for malware, and a GET that accepted a
 * request would be answered by a robot before the driver ever read it.
 * So GET renders a confirmation page and the actual change happens on
 * POST, which nothing prefetches.
 */

function page({ title, heading, message, accent = COLORS.coral, action }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)} · CampusHop</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${COLORS.paper};
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: ${COLORS.ink};
        padding: 20px;
      }
      .card {
        width: 100%;
        max-width: 460px;
        background: #fff;
        border: 1px solid ${COLORS.line};
        border-radius: 18px;
        overflow: hidden;
      }
      .banner {
        background: ${accent};
        padding: 24px 30px;
      }
      .banner b { font-size: 19px; letter-spacing: -0.02em; }
      .banner div {
        margin-top: 4px;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        opacity: 0.72;
      }
      .body { padding: 28px 30px 30px; }
      h1 { margin: 0 0 12px; font-size: 22px; letter-spacing: -0.02em; }
      p { margin: 0 0 20px; font-size: 15px; line-height: 1.6; }
      .muted { color: ${COLORS.muted}; font-size: 13px; }
      button, .link {
        display: inline-block;
        padding: 13px 26px;
        border: 0;
        border-radius: 999px;
        font-size: 15px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        text-decoration: none;
        color: #fff;
        background: ${COLORS.sage};
      }
      .link { background: ${COLORS.coral}; color: ${COLORS.ink}; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="banner">
        <b>CampusHop</b>
        <div>${esc(title)}</div>
      </div>
      <div class="body">
        <h1>${esc(heading)}</h1>
        <p>${message}</p>
        ${action || `<a class="link" href="${esc(config.appUrl)}">Open CampusHop</a>`}
      </div>
    </div>
  </body>
</html>`;
}

/** Shared by both verbs: resolve the token to a request we may act on. */
async function resolve(token) {
  const parsed = readActionToken(token);

  if (!parsed) return { error: "This link is no longer valid. It may have expired, or already been used." };

  const { data: request } = await db
    .from("trip_requests")
    .select("id, ride_id, rider_id, status")
    .eq("id", parsed.requestId)
    .maybeSingle();

  if (!request) {
    return { error: "That request no longer exists — it may have been cancelled." };
  }

  if (request.status !== "pending") {
    return { settled: request.status, request };
  }

  const { data: ride } = await db
    .from("rides")
    .select("id, driver_id, pickup, dropoff, date, time, seats, vehicle")
    .eq("id", request.ride_id)
    .maybeSingle();

  return { request, ride, action: parsed.action };
}

/** Ask. Never acts — see the note at the top of this file. */
router.get("/action", async (req, res, next) => {
  try {
    const result = await resolve(req.query.token);

    if (result.error) {
      return res
        .status(400)
        .send(page({ title: "Link expired", heading: "This link no longer works.", message: esc(result.error) }));
    }

    if (result.settled) {
      return res.send(
        page({
          title: "Already answered",
          heading: `Already ${esc(result.settled)}.`,
          message: "Somebody has answered this request already — no need to do anything.",
        })
      );
    }

    const { ride, action } = result;
    const accepting = action === "accepted";
    const rideLine = `${esc(ride?.pickup)} to ${esc(ride?.dropoff)}, ${esc(ride?.date)} at ${esc(ride?.time)}`;

    res.send(
      page({
        title: accepting ? "Accept request" : "Decline request",
        accent: accepting ? COLORS.sageLight : COLORS.lavenderLight,
        heading: accepting ? "Accept this request?" : "Decline this request?",
        message: `<strong>${rideLine}</strong><br><span class="muted">One tap to confirm. Nothing has changed yet.</span>`,
        action: `
          <form method="POST" action="/api/requests/action">
            <input type="hidden" name="token" value="${esc(req.query.token)}">
            <button type="submit"${accepting ? "" : ` style="background:${COLORS.coralDark}"`}>
              Yes, ${accepting ? "accept" : "decline"}
            </button>
          </form>`,
      })
    );
  } catch (err) {
    next(err);
  }
});

/** Act. Reached only from the confirmation page above. */
router.post("/action", async (req, res, next) => {
  try {
    const token = req.body?.token || req.query.token;
    const result = await resolve(token);

    if (result.error) {
      return res
        .status(400)
        .send(page({ title: "Link expired", heading: "This link no longer works.", message: esc(result.error) }));
    }

    if (result.settled) {
      return res.send(
        page({
          title: "Already answered",
          heading: `Already ${esc(result.settled)}.`,
          message: "Somebody has answered this request already — no need to do anything.",
        })
      );
    }

    const { request, ride, action } = result;

    // The token proves who may answer, but not that there is still room.
    if (action === "accepted") {
      const { data: accepted } = await db
        .from("trip_requests")
        .select("id")
        .eq("ride_id", request.ride_id)
        .eq("status", "accepted");

      if ((accepted?.length || 0) >= (ride?.seats || 1)) {
        return res.send(
          page({
            title: "Ride full",
            heading: "No seats left.",
            message: "This ride filled up before you answered. The request has been left alone.",
          })
        );
      }
    }

    const { error } = await db
      .from("trip_requests")
      .update({ status: action })
      .eq("id", request.id)
      // Only if still pending, so two taps cannot both apply.
      .eq("status", "pending");

    if (error) throw error;

    const accepting = action === "accepted";

    res.send(
      page({
        title: accepting ? "Accepted" : "Declined",
        accent: accepting ? COLORS.sageLight : COLORS.lavenderLight,
        heading: accepting ? "Seat confirmed." : "Request declined.",
        message: accepting
          ? "The passenger has been told, and the seat is theirs. You can see the trip in CampusHop."
          : "The passenger has been told, so they can look for another ride.",
      })
    );

    const driver = ride?.driver_id
      ? (
          await db
            .from("profiles")
            .select("name, phone, vehicle_number")
            .eq("id", ride.driver_id)
            .maybeSingle()
        ).data
      : null;

    const { data: accepted } = await db
      .from("trip_requests")
      .select("id")
      .eq("ride_id", request.ride_id)
      .eq("status", "accepted");

    notify.notifyRequestAnswered({
      status: action,
      riderId: request.rider_id,
      driver,
      ride: ride
        ? { ...ride, seatsLeft: Math.max(0, (ride.seats || 1) - (accepted?.length || 0)) }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
