import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./lib/api";

// The wording is deliberately from the reporter's side rather than the
// database's: "they never turned up" is what happened, `no_show` is what
// it is stored as. Each side gets the phrasing that fits what they saw.
const REASONS = [
  {
    value: "unsafe_driving",
    driver: "They behaved unsafely during the ride",
    rider: "Unsafe or reckless driving",
  },
  {
    value: "no_show",
    driver: "They never turned up at the pickup point",
    rider: "The driver never turned up",
  },
  {
    value: "wrong_vehicle",
    driver: "They got into the wrong vehicle",
    rider: "Different vehicle or number plate than listed",
  },
  {
    value: "harassment",
    driver: "Harassment or inappropriate behaviour",
    rider: "Harassment or inappropriate behaviour",
  },
  {
    value: "payment",
    driver: "A disagreement about money",
    rider: "A disagreement about money",
  },
  {
    value: "other",
    driver: "Something else",
    rider: "Something else",
  },
];

/**
 * Reporting a trip that went wrong.
 *
 * Open to both sides. A rider left standing at a kerb and a driver who
 * waited for someone that never came are the same failure seen from two
 * ends, and an app where only one of them can say so is telling the other
 * that what happened to them does not count.
 *
 * The form never asks who it is about — there are two people on a trip and
 * the server knows which one is filing, so naming the other would only be
 * a way to get it wrong, or to abuse it.
 */
export default function ReportTrip({ tripId, role = "rider", withName, onClose }) {
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [already, setAlready] = useState([]);

  const isDriver = role === "driver";

  // What this person has already filed about this trip, so the form can
  // say so rather than letting them submit into a duplicate error.
  useEffect(() => {
    let cancelled = false;

    api.reports
      .forTrip(tripId)
      .then((reports) => !cancelled && setAlready(reports.map((r) => r.category)))
      .catch(() => {
        // Not worth blocking the form over — the server still refuses a
        // genuine duplicate.
      });

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const submit = async (e) => {
    e.preventDefault();

    if (!category || sending) return;

    setSending(true);
    setError("");

    try {
      await api.reports.create({ requestId: tripId, category, details });
      setDone(true);
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="report-modal">
        {done ? (
          <>
            <span className="eyebrow">REPORT FILED</span>
            <h2>Thank you for telling us.</h2>
            <p>
              It has been recorded against this trip and can be seen by whoever
              looks after safety on campus. You can find it again under your own
              reports.
            </p>

            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <span className="eyebrow">REPORT A PROBLEM</span>

            <h2>What went wrong?</h2>

            <p className="report-intro">
              About your trip with {withName || (isDriver ? "your rider" : "your driver")}.
              Nothing is sent to them, and they are not told you filed it.
            </p>

            <div className="report-reasons">
              {REASONS.map((reason) => {
                const filed = already.includes(reason.value);

                return (
                  <label
                    key={reason.value}
                    className={`report-reason ${
                      category === reason.value ? "selected" : ""
                    } ${filed ? "is-filed" : ""}`}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={reason.value}
                      checked={category === reason.value}
                      disabled={filed}
                      onChange={() => setCategory(reason.value)}
                    />

                    <span>{isDriver ? reason.driver : reason.rider}</span>

                    {filed && <small>already reported</small>}
                  </label>
                );
              })}
            </div>

            <label className="report-details">
              What happened? <small>Optional, but it is what makes a report useful.</small>
              <textarea
                rows={4}
                maxLength={2000}
                value={details}
                placeholder="Where, when, and what was said or done."
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="modal-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={!category || sending}
              >
                {sending ? "Sending…" : "Send report"}
              </button>

              <button type="button" className="secondary-button" onClick={onClose}>
                Not now
              </button>
            </div>

            {/* Said last, because it is the thing that matters most and is
                the least likely to be read first. */}
            <p className="report-urgent">
              If you are in danger right now, call campus security or 112 —
              this form is not read in real time.
            </p>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
