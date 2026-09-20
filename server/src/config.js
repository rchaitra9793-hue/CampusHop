require("dotenv").config();

const ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim();

/**
 * A Supabase key, or nothing.
 *
 * Whatever is in this variable becomes the credential every query in the
 * app runs under, so something that is not a key cannot be allowed
 * through: it would not fail at startup, it would fail on every request
 * afterwards, with an error about an invalid key rather than about the
 * line in .env that caused it.
 *
 * The field this gets confused with is the project reference — it sits
 * near the keys in the dashboard, it is the memorable-looking string in
 * the project URL, and it is not a secret at all.
 *
 * Keys come in two shapes: the older signed JWT (three dot-separated
 * parts, a couple of hundred characters) and the newer sb_secret_ /
 * sb_publishable_ form. Anything else is a paste that went wrong.
 */
function usableKey(raw, variable) {
  const value = raw?.trim();

  if (!value) return undefined;

  const jwt = value.split(".").length === 3 && value.length > 100;
  const modern = /^sb_(secret|publishable)_/.test(value);

  if (jwt || modern) {
    // The right shape, but is it the right one of the two? A publishable
    // key in the service slot is the mistake this catches.
    if (variable === "SUPABASE_SERVICE_ROLE_KEY" && value.startsWith("sb_publishable_")) {
      console.warn(
        `\n  ${variable} holds a publishable key, not a secret one.\n` +
          "  The secret key is the one hidden behind Reveal in the dashboard.\n" +
          "  Ignoring it and using the anon key.\n"
      );

      return undefined;
    }

    return value;
  }

  const looksLikeProjectRef =
    process.env.SUPABASE_URL?.includes(value) && value.length < 40;

  console.warn(
    `\n  ${variable} does not look like a Supabase key, so it is being ignored.\n` +
      (looksLikeProjectRef
        ? "  It is the project reference - the same string that is in\n" +
          "  SUPABASE_URL, and not a secret at all. The key you want is under\n" +
          "  Project Settings -> API Keys, behind the Reveal button, and is\n" +
          "  far longer than this.\n"
        : `  A key is either a long JWT or begins sb_secret_ / sb_publishable_;\n` +
          `  this is ${value.length} characters and neither.\n`) +
      "  Using it as the database credential would fail every query, so the\n" +
      "  server is carrying on without it.\n"
  );

  return undefined;
}

const SERVICE_KEY = usableKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  "SUPABASE_SERVICE_ROLE_KEY"
);

if (!process.env.SUPABASE_URL || !(SERVICE_KEY || ANON_KEY)) {
  console.error("Missing SUPABASE_URL or a Supabase key. Check server/.env");
  process.exit(1);
}

if (!SERVICE_KEY) {
  // "Not set" would be a lie when the variable is filled in with the
  // wrong thing, which is the harder of the two mistakes to spot.
  const present = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

  console.warn(
    `\n  WARNING: SUPABASE_SERVICE_ROLE_KEY is ${present ? "not usable" : "not set"}.\n` +
      "  Falling back to the anon key, which is subject to row-level security.\n" +
      "  Add the service_role key (Supabase -> Project Settings -> API) so the\n" +
      "  API server can enforce ownership rules itself.\n"
  );
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: SERVICE_KEY || ANON_KEY,
  usingServiceKey: Boolean(SERVICE_KEY),

  // Verifying user tokens always uses the public key.
  supabaseAnonKey: ANON_KEY,

  orsKey: process.env.ORS_API_KEY?.trim(),

  // A ride's date and time are the driver's local wall clock, so deciding
  // whether one has departed needs to know which clock that is. One campus
  // is one zone; this must match campushop_timezone() in the migration.
  campusTimezone: process.env.CAMPUS_TIMEZONE?.trim() || "Asia/Kolkata",

  // How long after departure a ride nobody joined is kept before it is
  // deleted. It is off the board the moment it departs either way — this
  // only covers the driver who is running late, or long, and whose trip
  // should not be deleted out from under them mid-journey.
  rideGraceMinutes: Number(process.env.RIDE_GRACE_MINUTES) || 180,

  // How often to sweep. Nothing is waiting on it: the board is filtered on
  // every read, so this only decides when the rows actually go.
  rideSweepMinutes: Number(process.env.RIDE_SWEEP_MINUTES) || 15,

  // How long a finished trip is kept before it is deleted. It leaves the
  // Upcoming list the moment it is over either way — this is only how long
  // it stays in History, which is the window a rider has to report a trip
  // that went wrong after getting home.
  tripHistoryDays: Number(process.env.TRIP_HISTORY_DAYS) || 7,

  // Google does place search and pin-naming. Server-side only: this key
  // has quota and billing attached, so it never goes to the browser.
  googleMapsKey: process.env.GOOGLE_MAPS_KEY?.trim(),

  // Notifications, over plain SMTP so the provider is a matter of
  // configuration rather than code. Gmail needs an App Password, which
  // Google does not offer on every account; Brevo and the rest hand out
  // an SMTP key on signup. Set SMTP_HOST to use one of those, leave it
  // unset for Gmail. Unset credentials simply turn notifications off.
  smtpHost: process.env.SMTP_HOST?.trim(),
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER?.trim(),
  smtpPass: process.env.SMTP_PASS?.replace(/\s+/g, ""),
  smtpFrom: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim(),

  // Where the links in an email should land.
  appUrl: (process.env.APP_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173").replace(/\/$/, ""),
  apiUrl: (process.env.API_URL || `http://localhost:${Number(process.env.PORT) || 5000}`).replace(/\/$/, ""),

  // Signs the one-click Accept / Decline links. Falls back to the
  // service key so a missing secret cannot silently make every token
  // forgeable with an empty string.
  actionSecret:
    process.env.ACTION_TOKEN_SECRET?.trim() ||
    SERVICE_KEY ||
    ANON_KEY ||
    "campushop-unsafe-development-secret",
};
