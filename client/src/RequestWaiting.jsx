import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import campushopLogo from "./assets/campushop-logo.png";
import { api } from "./lib/api";

// How long we hold the door open before admitting the driver may simply
// not be looking at their phone.
const WAIT_SECONDS = 60;

// Often enough to feel immediate, rarely enough to be cheap.
const POLL_MS = 3000;

/**
 * The wait between asking for a seat and hearing back.
 *
 * A request used to vanish into the Trips tab with no acknowledgement,
 * which reads as though nothing happened. This holds the moment: a minute
 * on the clock, the scooter going somewhere, and a way out at any point.
 *
 * The countdown is not a deadline — nothing expires when it runs out. The
 * request stays open and the driver can still answer; the timer only
 * marks when to stop staring at it. Pretending otherwise would mean
 * cancelling seats out from under people who were three minutes from
 * checking their phone.
 */
export default function RequestWaiting({ rideId, tripId, driverName, onClose, onAccepted }) {
  const [status, setStatus] = useState("pending");
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");

  const settledRef = useRef(false);

  // --- the clock --------------------------------------------------------

  useEffect(() => {
    if (status !== "pending") return;

    const started = Date.now();
    const timer = setInterval(() => {
      setElapsed((Date.now() - started) / 1000);
    }, 100);

    return () => clearInterval(timer);
  }, [status]);

  // --- has the driver answered? -----------------------------------------

  useEffect(() => {
    if (status !== "pending") return;

    let cancelled = false;

    const check = async () => {
      try {
        const trips = await api.requests.mine();

        if (cancelled || settledRef.current) return;

        const mine = trips.find((t) => t.tripId === tripId || t.rideId === rideId);

        // Gone entirely means the driver removed the ride, or it was
        // cancelled elsewhere — either way there is nothing to wait for.
        if (!mine) {
          settledRef.current = true;
          setStatus("gone");
          return;
        }

        if (mine.status === "accepted" || mine.status === "declined") {
          settledRef.current = true;
          setStatus(mine.status);
        }
      } catch {
        // A failed poll is not an answer. Keep waiting.
      }
    };

    check();

    const timer = setInterval(check, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, tripId, rideId]);

  const cancel = async () => {
    if (cancelling) return;

    setCancelling(true);
    setError("");

    try {
      await api.requests.cancel(tripId);
      settledRef.current = true;
      onClose({ cancelled: true });
    } catch (err) {
      setError(err.message);
      setCancelling(false);
    }
  };

  const progress = Math.min(1, elapsed / WAIT_SECONDS);
  const left = Math.max(0, Math.ceil(WAIT_SECONDS - elapsed));
  const overdue = progress >= 1;

  // --- what the panel says ----------------------------------------------

  const copy = {
    pending: {
      title: overdue ? "Still waiting…" : `Asking ${driverName || "the driver"}…`,
      body: overdue
        ? "They haven't picked up their phone yet. Your request is still open — you can keep waiting or take the seat back."
        : "Your request is with them now. This usually takes a moment.",
    },
    accepted: {
      title: "You've got a seat!",
      body: `${driverName || "The driver"} accepted. Let's get you to the pickup point.`,
    },
    declined: {
      title: "Not this time",
      body: `${driverName || "The driver"} couldn't take this one. The board has other rides going your way.`,
    },
    gone: {
      title: "That ride is gone",
      body: "It was taken down before your request was answered.",
    },
  }[status];

  return createPortal(
    <div className="modal-backdrop">
      <div className={`waiting-modal waiting-modal--${status}`}>
        <div className="modal-sticker">HOP!</div>

        {/* The scooter goes somewhere while you wait. It stops when there
            is an answer — a logo still cheerfully driving along under
            "Not this time" would be reading the room badly. */}
        <div className={`waiting-road ${status === "pending" ? "waiting-road--moving" : ""}`}>
          <div className="waiting-scooter">
            {/* The real logo artwork, cropped to the scooter. The hand-drawn
                SVG in CampusHopLogo is a rough approximation of it and does
                not hold up at this size. */}
            <img src={campushopLogo} alt="" aria-hidden="true" />
          </div>

          <div className="waiting-road-line" />
        </div>

        <span className="eyebrow">
          {status === "pending" ? "RIDE REQUEST SENT" : "RIDE REQUEST"}
        </span>

        <h2>{copy.title}</h2>
        <p>{copy.body}</p>

        {status === "pending" && (
          <div className="waiting-progress">
            <div
              className={`waiting-progress-bar ${overdue ? "waiting-progress-bar--overdue" : ""}`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {status === "pending" && !overdue && (
          <div className="waiting-count">{left}s</div>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          {status === "pending" ? (
            <>
              <button
                type="button"
                className="danger-button"
                onClick={cancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel this request"}
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => onClose({ cancelled: false })}
              >
                Wait in the background
              </button>
            </>
          ) : status === "accepted" ? (
            <button type="button" className="primary-button" onClick={onAccepted}>
              Go to pickup →
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => onClose({ cancelled: false })}
            >
              Find another ride
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
