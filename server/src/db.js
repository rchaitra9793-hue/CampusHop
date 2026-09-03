const { createClient } = require("@supabase/supabase-js");
const config = require("./config");

/**
 * The database handle. Supabase is the datastore behind this API — the
 * browser no longer touches it directly, so every query in the app runs
 * through here and every rule is enforced server-side.
 */
const db = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * A separate client used only to validate the caller's access token.
 * It must use the public key, since that is what the token was issued
 * against.
 */
const authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = { db, authClient };
