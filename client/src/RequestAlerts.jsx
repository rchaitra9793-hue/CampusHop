import React, { useState } from "react";

/**
 * Ride requests announced wherever the driver happens to be.
 *
 * A request is time-sensitive — someone is waiting on an answer to plan
 * their morning — and the driver has no reason to be sitting on the
 * Requests tab when one arrives. So it is answerable from here, on any
 * page, without losing whatever they were in the middle of.
 */
export default function RequestAlerts({
  alerts,
  onAnswer,
  onDismiss,
  onOpenRequests,
  onAccepted,
}) {
  const [busy, setBusy] = useState(null);

  if (!alerts || alerts.length === 0) return null;

  const answer = async (request, status) => {
    setBusy(request.id);

    try {
      await onAnswer(request.id, status);

      // Straight to the live map, as from the Requests tab.
      if (status === "accepted") onAccepted?.(request);
    } catch {
      // The hook surfaces the message; the card stays put so the driver
      // can try again.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="request-alerts" role="region" aria-label="New ride requests">
      {alerts.map((r) => (
        <article className="request-alert" key={r.id}>
          <div className="request-alert-tape" />

          <button
            type="button"
            className="request-alert-close"
            onClick={() => onDismiss(r.id)}
            aria-label="Dismiss"
          >
            ×
          </button>

          <span className="eyebrow">NEW RIDE REQUEST</span>

          <div className="request-alert-person">
            <div className="avatar">{r.riderName?.slice(0, 2).toUpperCase()}</div>

            <div>
              <strong>{r.riderName}</strong>
              <span>wants a seat · #{r.position} in line</span>
            </div>
          </div>

          <div className="request-alert-route">
            <strong>{r.ride?.pickup}</strong>
            <span>→</span>
            <strong>{r.ride?.dropoff}</strong>
          </div>

          <div className="request-alert-when">
            {r.ride?.date} · {r.ride?.time} · {r.seatsLeft} of {r.seats} seats left
          </div>

          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={busy === r.id}
              onClick={() => answer(r, "declined")}
            >
              Decline
            </button>

            <button
              className="primary-button"
              disabled={busy === r.id || r.seatsLeft === 0}
              onClick={() => answer(r, "accepted")}
            >
              {busy === r.id ? "…" : r.seatsLeft === 0 ? "No seats left" : "Accept →"}
            </button>
          </div>

          <button
            type="button"
            className="text-button"
            onClick={() => {
              onDismiss(r.id);
              onOpenRequests();
            }}
          >
            See all requests
          </button>
        </article>
      ))}
    </div>
  );
}
