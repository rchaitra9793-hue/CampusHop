import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Long enough to read the message, short enough not to feel stuck.
const REDIRECT_SECONDS = 5;

/**
 * "Your ride is completed" / "Your ride has been cancelled".
 *
 * With `redirect` (the default, used for cancellations) it counts down and
 * takes the person back to the home page on its own. Without it (used for
 * a completed ride) it is just a message: "OK" closes it and leaves them
 * on the page they were on, to go home themselves with Back.
 */
export default function RideOutcome({ kind, title, message, onDone, redirect = true }) {
  const [left, setLeft] = useState(REDIRECT_SECONDS);

  // Held in a ref so a parent re-rendering with a new callback does not
  // restart the countdown.
  const doneRef = useRef(null);
  const firedRef = useRef(false);

  useEffect(() => {
    doneRef.current = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onDone?.();
    };
  }, [onDone]);

  useEffect(() => {
    if (!redirect) return undefined;

    const started = Date.now();

    const timer = setInterval(() => {
      const remaining = REDIRECT_SECONDS - Math.floor((Date.now() - started) / 1000);

      if (remaining <= 0) {
        clearInterval(timer);
        doneRef.current?.();
        return;
      }

      setLeft(remaining);
    }, 250);

    return () => clearInterval(timer);
  }, [redirect]);

  const completed = kind === "completed";

  return createPortal(
    <div className="modal-backdrop ride-outcome-backdrop" role="alertdialog" aria-live="assertive">
      <div className={`request-modal ride-outcome ride-outcome--${kind}`}>
        <div className="ride-outcome-icon" aria-hidden="true">
          {completed ? "✓" : "✕"}
        </div>

        <span className="eyebrow">{completed ? "RIDE COMPLETED" : "RIDE CANCELLED"}</span>

        <h2>{title || (completed ? "Your ride is completed" : "Your ride has been cancelled")}</h2>

        {message && <p>{message}</p>}

        {redirect && (
          <p className="ride-outcome-count">
            Taking you to the home page in {left}s…
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="primary-button" onClick={() => doneRef.current?.()}>
            {redirect ? "Go to home now →" : "OK"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
