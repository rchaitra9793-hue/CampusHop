// Renders every notification to an HTML file so the design can be
// looked at without sending anything. Nothing here touches the database
// or the mail server.
//
//   node db/preview-emails.mjs [outputDir]
//
// Then open the files it names in a browser.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const templates = require("../server/src/email/templates.js");

const outDir = resolve(process.argv[2] || "email-preview");
mkdirSync(outDir, { recursive: true });

const ride = {
  pickup: "Hosakerehalli",
  dropoff: "BMS College for Women",
  date: "2026-09-08",
  time: "08:30",
  seats: 2,
  seatsLeft: 1,
  vehicle: "Bike",
};

const samples = {
  "1-request-received": templates.requestReceived({
    driverName: "Ankitha",
    riderName: "Chaitra",
    ride,
    createdAt: new Date().toISOString(),
    acceptUrl: "https://example.test/api/requests/action?token=demo-accept",
    declineUrl: "https://example.test/api/requests/action?token=demo-decline",
    boardUrl: "http://localhost:5173",
  }),

  "2-accepted": templates.requestAccepted({
    riderName: "Chaitra",
    driverName: "Ankitha",
    ride,
    driverPhone: "+91 90000 00000",
    vehicleNumber: "KA 05 MJ 1234",
    tripUrl: "http://localhost:5173",
  }),

  "3-declined": templates.requestDeclined({
    riderName: "Chaitra",
    driverName: "Ankitha",
    ride,
    findUrl: "http://localhost:5173",
  }),

  "4-cancelled-by-driver": templates.requestCancelled({
    toName: "Chaitra",
    byName: "Ankitha",
    byRole: "driver",
    ride,
    findUrl: "http://localhost:5173",
  }),

  "5-cancelled-by-rider": templates.requestCancelled({
    toName: "Ankitha",
    byName: "Chaitra",
    byRole: "rider",
    ride,
    findUrl: "http://localhost:5173",
  }),
};

for (const [name, message] of Object.entries(samples)) {
  const file = join(outDir, `${name}.html`);
  writeFileSync(file, message.html, "utf8");
  console.log(`${file}\n   subject: ${message.subject}\n`);
}

console.log(`${Object.keys(samples).length} previews written to ${outDir}`);
