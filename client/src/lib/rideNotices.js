// Which "your ride was completed / cancelled" messages this browser has
// already shown, so each one is said once — whether it was seen on the
// live screen or on whatever page the person happened to be on.
const KEY = "campushop.rideNotices";

function read() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function noticeSeen(key) {
  return read().has(key);
}

export function markNoticeSeen(key) {
  try {
    const seen = read();
    seen.add(key);

    // Only the recent ones matter; keep the list from growing forever.
    localStorage.setItem(KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // Storage unavailable — the message may simply be shown again.
  }
}

export const cancelKey = (requestId) => `cancel:${requestId}`;
export const completeKey = (requestId) => `complete:${requestId}`;

/** A request status that means one side called the ride off. */
export function isCancelledStatus(status) {
  return status === "cancelled_by_rider" || status === "cancelled_by_driver";
}

/** How a request status reads on a card. */
export function statusLabel(status) {
  if (status === "cancelled_by_rider") return "cancelled by rider";
  if (status === "cancelled_by_driver") return "cancelled by driver";
  return status;
}
