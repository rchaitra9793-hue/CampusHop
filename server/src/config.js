require("dotenv").config();

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim();

if (!process.env.SUPABASE_URL || !(SERVICE_KEY || ANON_KEY)) {
  console.error("Missing SUPABASE_URL or a Supabase key. Check server/.env");
  process.exit(1);
}

if (!SERVICE_KEY) {
  console.warn(
    "\n  WARNING: SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
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

  // Google does place search and pin-naming. Server-side only: this key
  // has quota and billing attached, so it never goes to the browser.
  googleMapsKey: process.env.GOOGLE_MAPS_KEY?.trim(),
};
