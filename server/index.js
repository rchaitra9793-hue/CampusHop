// CampusHop API server.
//
// The browser no longer talks to the database. Every read and write goes
// through these endpoints, which establish who the caller is from a
// signed token and enforce the rules — a driver may only edit their own
// ride, only the driver may answer a request, a ride cannot be oversold.
//
// The routing API key lives here too, so it never ships to the client.

const express = require("express");
const cors = require("cors");

const config = require("./src/config");
const { requireAuth } = require("./src/auth");
const { startRideSweeper } = require("./src/sweepRides");

const ridesRoutes = require("./src/routes/rides").router;
const reportRoutes = require("./src/routes/reports").router;
const requestRoutes = require("./src/routes/requests");
const geoRoutes = require("./src/routes/geo");
const profileRoutes = require("./src/routes/profile");
const requestActionRoutes = require("./src/routes/requestActions");

const app = express();

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// The email confirmation page posts a normal HTML form, not JSON.
app.use(express.urlencoded({ extended: false }));

// Lightweight request log; useful when demonstrating that the client is
// genuinely going through the API.
app.use((req, res, next) => {
  const started = Date.now();

  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`
    );
  });

  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "campushop-api",
    routing: Boolean(config.orsKey),
    places: Boolean(config.googleMapsKey),
    privilegedDatabaseAccess: config.usingServiceKey,
    emailNotifications: require("./src/email").enabled,
  });
});

// Answering a request from the notification email. Mounted before the
// authenticated router below, and deliberately outside it: the driver
// reading their inbox is not signed in, which is the whole point of
// having emailed them. The signed token in the link is the authority.
app.use("/api/requests", requestActionRoutes);

// Everything below requires a signed-in user.
app.use("/api/geo", requireAuth, geoRoutes);
app.use("/api/rides", requireAuth, ridesRoutes);
app.use("/api/requests", requireAuth, requestRoutes);
app.use("/api/profile", requireAuth, profileRoutes);
app.use("/api/reports", requireAuth, reportRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// The database being unreachable is not a bug in this server, and saying
// "something went wrong" about it sends whoever is looking into the code
// rather than at the wifi. It happens for real: a laptop sleeps, a network
// drops, and every request in flight fails at the DNS lookup.
const OFFLINE = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up/i;

function looksOffline(err) {
  return OFFLINE.test(`${err?.message} ${err?.details} ${err?.cause?.message}`);
}

// Central error handler. Upstream failures carry their own status; the
// rest are treated as server faults and logged rather than leaked.
app.use((err, req, res, _next) => {
  // A dropped connection is reported as exactly that, and logged as one
  // line rather than a stack trace — a network outage produces one of
  // these per request in flight, and a page of identical stacks buries
  // whatever else was in the log.
  if (looksOffline(err)) {
    console.warn(
      `  Cannot reach the database (${req.method} ${req.originalUrl}) — network or Supabase is down.`
    );

    return res.status(503).json({
      error:
        "Cannot reach the database right now. Check your connection — " +
        "this usually clears on its own.",
    });
  }

  const status = err.status || 500;

  if (status >= 500) {
    console.error("Unhandled error:", err);
  }

  res.status(status).json({
    error: status >= 500 ? "Something went wrong on the server." : err.message,
  });
});

app.listen(config.port, () => {
  console.log(`CampusHop API listening on http://localhost:${config.port}`);
  console.log(`  allowing origin      : ${config.clientOrigin}`);
  console.log(`  routing configured   : ${Boolean(config.orsKey)}`);
  console.log(`  google places        : ${Boolean(config.googleMapsKey)}`);
  console.log(`  service-role database: ${config.usingServiceKey}`);
  console.log(`  email notifications  : ${require("./src/email").enabled}`);
  console.log(`  campus timezone      : ${config.campusTimezone}`);

  // Rides that have left are filtered out of every board read, so this is
  // not what makes them disappear — it is what stops the table filling up
  // with rides nobody ever joined. On boot first, because a server that
  // was off overnight comes back to a table full of yesterday.
  startRideSweeper();
});
