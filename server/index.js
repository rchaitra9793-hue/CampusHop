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

const ridesRoutes = require("./src/routes/rides").router;
const requestRoutes = require("./src/routes/requests");
const geoRoutes = require("./src/routes/geo");
const profileRoutes = require("./src/routes/profile");

const app = express();

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

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
  });
});

// Everything below requires a signed-in user.
app.use("/api/geo", requireAuth, geoRoutes);
app.use("/api/rides", requireAuth, ridesRoutes);
app.use("/api/requests", requireAuth, requestRoutes);
app.use("/api/profile", requireAuth, profileRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// Central error handler. Upstream failures carry their own status; the
// rest are treated as server faults and logged rather than leaked.
app.use((err, req, res, _next) => {
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
});
