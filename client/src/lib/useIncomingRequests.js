import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { departed } from "./rideState";

// The driver is not sitting on the Requests tab waiting, so this polls
// from the dashboard shell instead — often enough to feel live, rarely
// enough to stay cheap.
const POLL_MS = 8000;


/**
 * The driver's incoming requests, polled once for the whole app.
 *
 * Returns the list, plus `alerts`: every request still waiting on an
 * answer. A rider is left planning their morning around a seat nobody
 * has confirmed, so an alert is not an announcement that can be missed
 * once and lost — it stands until the driver accepts or declines, and it
 * is there again on every sign-in, reload and return to the page.
 *
 * Dismissing one sets it aside for the current page only. That is
 * deliberately not remembered: the rider is still waiting either way, so
 * the next visit surfaces it again.
 */
export function useIncomingRequests(userId) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Requests the driver has waved away on this page. Held in memory on
  // purpose — a reload or a fresh sign-in brings them all back.
  const [setAside, setSetAside] = useState(() => new Set());

  // Reset when the account changes, so one driver's queue is never shown
  // to another.
  useEffect(() => {
    setSetAside(new Set());
    setRequests([]);
    setLoading(true);
  }, [userId]);

  const load = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);

      try {
        const incoming = await api.requests.incoming();

        setRequests(incoming);
        setError("");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    // The endpoint resolves the driver from the caller's token, so this
    // does not vary with userId; the effect below re-runs on a change.
    []
  );

  useEffect(() => {
    if (!userId) return;

    load();

    const timer = setInterval(() => load(true), POLL_MS);

    // Polling a backgrounded tab is wasted; coming back to it should show
    // the current state immediately rather than after the next tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, load]);

  /** Accept or decline. The popup and the Requests tab share this. */
  const answer = useCallback(
    async (id, status) => {
      try {
        await api.requests.setStatus(id, status);

        // The reload below drops it from `alerts` anyway once the server
        // reports the new status; setting it aside now avoids the card
        // lingering for the length of that round trip.
        setSetAside((current) => new Set(current).add(id));

        await load(true);
      } catch (err) {
        setError(err.message);
        load(true);
        throw err;
      }
    },
    [load]
  );

  const dismiss = useCallback((id) => {
    setSetAside((current) => new Set(current).add(id));
  }, []);

  // Standing, not announced: derived from what the server says is still
  // pending, so nothing is lost to a missed render or a closed tab. It
  // stops standing once the ride it concerns has departed.
  const alerts = requests.filter(
    (r) => r.status === "pending" && !setAside.has(r.id) && !departed(r.ride)
  );

  const withExpiry = requests.map((r) => ({
    ...r,
    expired: r.status === "pending" && departed(r.ride),
  }));

  return {
    requests: withExpiry,
    loading,
    error,
    alerts,
    answer,
    dismiss,
    refresh: load,
  };
}
