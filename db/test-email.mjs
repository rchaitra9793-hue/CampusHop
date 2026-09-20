// Checks the notification setup end to end, without touching the app.
//
//   node db/test-email.mjs                 verify the SMTP login only
//   node db/test-email.mjs you@gmail.com   also send one real test email
//
// Run it after filling in SMTP_USER and SMTP_PASS in server/.env. It
// reports exactly which step failed, which beats a silent non-delivery.
//
// Works with any SMTP provider. Set SMTP_HOST for Brevo and friends;
// leave it unset for Gmail.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..", "server");

const require = createRequire(import.meta.url);

// config reads server/.env relative to the process, so start from there.
process.chdir(serverDir);

const config = require(join(serverDir, "src", "config.js"));
const nodemailer = require(join(serverDir, "node_modules", "nodemailer"));
const templates = require(join(serverDir, "src", "email", "templates.js"));

const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);

console.log("\nCampusHop email check\n");

// 1 — is it configured at all?
if (!config.smtpUser || !config.smtpPass) {
  bad("SMTP_USER / SMTP_PASS are not set in server/.env");
  console.log("\n  Notifications are off. Add them and run this again.\n");
  process.exit(1);
}

const usingGmail = !config.smtpHost;
const provider = usingGmail ? "Gmail" : `${config.smtpHost}:${config.smtpPort}`;

ok(`provider  = ${provider}`);
ok(`SMTP_USER = ${config.smtpUser}`);
ok(`SMTP_PASS = ${"*".repeat(config.smtpPass.length)} (${config.smtpPass.length} chars)`);

// A Google App Password is 16 characters. Spaces are stripped on read,
// so the usual "abcd efgh ijkl mnop" copy/paste is fine. Other providers
// issue keys of their own length, so the check only applies to Gmail.
if (usingGmail && config.smtpPass.length !== 16) {
  console.log(
    `  NOTE  Google App Passwords are 16 characters; this one is ${config.smtpPass.length}.`
  );
  console.log("        If login fails, check you pasted an App Password and");
  console.log("        not your account password.");
}

ok(`links point at ${config.appUrl} (app) and ${config.apiUrl} (api)`);

if (!process.env.ACTION_TOKEN_SECRET) {
  console.log("  NOTE  ACTION_TOKEN_SECRET is unset, so Accept/Decline links are");
  console.log("        signed with a fallback. Fine locally; set it before deploying.");
}

// 2 — does the login actually work?
const transport = nodemailer.createTransport(
  usingGmail
    ? { service: "gmail", auth: { user: config.smtpUser, pass: config.smtpPass } }
    : {
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: { user: config.smtpUser, pass: config.smtpPass },
      }
);

try {
  await transport.verify();
  ok(`${provider} accepted the login`);
} catch (err) {
  bad(`${provider} rejected the login: ${err.message}`);

  if (/username and password not accepted|invalid login|badcredentials|authentication failed/i.test(err.message)) {
    console.log("\n  That is the error given for a rejected password.");

    if (usingGmail) {
      console.log("  On Gmail it usually means an account password was used rather");
      console.log("  than a 16-character App Password. If Google will not issue you");
      console.log("  one, switch provider — no code change, just server/.env:");
      console.log("    SMTP_HOST=smtp-relay.brevo.com");
      console.log("    SMTP_PORT=587");
      console.log("    SMTP_USER=<the login Brevo shows you>");
      console.log("    SMTP_PASS=<your Brevo SMTP key>");
    } else {
      console.log("  Check the SMTP key and the login your provider gave you —");
      console.log("  for most of them the SMTP username is not your email address.");
    }

    console.log("");
  }

  process.exit(1);
}

// 3 — optionally put a real one in an inbox.
const to = process.argv[2];

if (!to) {
  console.log("\n  Login works. Pass an address to send a real test:");
  console.log("    node db/test-email.mjs you@example.com\n");
  process.exit(0);
}

const message = templates.requestReceived({
  driverName: "there",
  riderName: "Chaitra",
  ride: {
    pickup: "Hosakerehalli",
    dropoff: "BMS College for Women",
    date: "2026-09-08",
    time: "08:30",
    seats: 2,
    seatsLeft: 1,
  },
  createdAt: new Date().toISOString(),
  // Deliberately dead links: this is a look-at-the-design test, and
  // pressing Accept here should not answer a real request.
  acceptUrl: `${config.appUrl}?test=accept`,
  declineUrl: `${config.appUrl}?test=decline`,
  boardUrl: config.appUrl,
});

try {
  const info = await transport.sendMail({
    from: `CampusHop <${config.smtpFrom}>`,
    to,
    subject: `[test] ${message.subject}`,
    html: message.html,
    text: message.text,
  });

  ok(`sent to ${to}`);
  console.log(`\n  Message id: ${info.messageId}`);
  console.log("  Check the inbox — and the spam folder the first time.\n");
} catch (err) {
  bad(`send failed: ${err.message}`);
  process.exit(1);
}
