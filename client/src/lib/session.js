/**
 * A token grouping the keystrokes of one search with the single lookup
 * that follows it.
 *
 * Google bills autocomplete per session rather than per request when the
 * two calls share one, so typing twelve characters costs one search
 * instead of twelve. Only the client can tell where a session begins and
 * ends — the server sees keystrokes, not intent — so the token is minted
 * here and passed through.
 */
export function newSessionToken() {
  if (crypto.randomUUID) return crypto.randomUUID();

  // Older Safari has crypto but not randomUUID.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
