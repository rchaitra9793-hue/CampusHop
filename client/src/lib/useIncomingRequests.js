import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

// The driver is not sitting on the Requests tab waiting, so this polls
// from the dashboard shell instead — often enough to feel live, rarely
// enough to stay cheap.
const POLL_MS = 8000;

const seenKey = (userId) => `campushop.seenRequests.${userId || "anon"}`;

function readSeen(userId) {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    return raw ? { set: new Set(JSON.parse(raw)), first: false } : { set: new Set(), first: true };
  } catch {
    // Private browsing, or storage disabled. Alerts still work for the
    // life of the page; they just cannot be remembered across a reload.
    return { set: new Set(), first: true };
  }
}

function writeSeen(userId, set) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify([...set]));
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * The driver's incoming requests, polled once for the whole app.
 *
 * Returns the list, plus `alerts`: requests that have appeared since this
 * driver last looked. Which ones those are has to survive a reload, so
 * the ids already announced are kept in local storage — otherwise every
 * refresh would re-announce the same pending requests.
 *
 * On the very first run for an account there is no record of what has
 * been seen, so the current queue is marked read silently rather than
 * firing a popup per request already sitting in the Requests tab.
 */
export function useIncomingRequests(userId) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState([]);

  const seenRef = useRef(null);

  // Reset when the account changes, so one user's read state is never
  // applied to another's queue.
  useEffect(() => {
    seenRef.current = null;
    setAlerts([]);
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

        const pending = incoming.filter((r) => r.status === "pending");

        if (seenRef.current === null) {
          const { set, first } = readSeen(userId);
          seenRef.current = set;

          if (first) {
            // Nothing has ever been announced to this account. Treat the
            // existing queue as already read.
            const seeded = new Set(pending.map((r) => r.id));
            seenRef.current = seeded;
            writeSeen(userId, seeded);
            return;
          }
        }

        const fresh = pending.filter((r) => !seenRef.current.has(r.id));

        if (fresh.length > 0) {
          fresh.forEach((r) => seenRef.current.add(r.id));
          setAlerts((current) => [...current, ...fresh]);
        }

        // Forget ids that no longer exist, so the record cannot grow
        // without bound over a term of use.
        const live = new Set(incoming.map((r) => r.id));
        seenRef.current = new Set([...seenRef.current].filter((id) => live.has(id)));

        writeSeen(userId, seenRef.current);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [userId]
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
        setAlerts((current) => current.filter((a) => a.id !== id));
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
    setAlerts((current) => current.filter((a) => a.id !== id));
  }, []);

  return { requests, loading, error, alerts, answer, dismiss, refresh: load };
}
