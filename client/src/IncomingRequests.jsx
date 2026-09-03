import React, { useState } from "react";

/**
 * The driver's full request queue.
 *
 * The data and the polling live in the dashboard now (useIncomingRequests),
 * because a request has to reach the driver whichever tab they are on.
 * This page renders the same list the popup draws from, so answering in
 * one place updates the other.
 */
export default function IncomingRequests({
  requests,
  loading,
  error,
  onAnswer,
  onAccepted,
}) {
  const [answering, setAnswering] = useState(null);

  const updateStatus = async (request, status) => {
    if (answering) return;

    setAnswering(request.id);

    try {
      await onAnswer(request.id, status);

      // Accepting turns a listing into a journey, so go straight to the
      // live map rather than leaving the driver to find it.
      if (status === "accepted") onAccepted?.(request);
    } catch {
      // The dashboard owns the error message.
    } finally {
      setAnswering(null);
    }
  };

  return (
    <main className="page-shell">
      <section className="page-heading">
        <span className="eyebrow">INCOMING REQUESTS</span>
        <h1>People want to ride with you.</h1>
        <p>
          Accept or decline requests for rides you&apos;ve posted. They are
          listed in the order they arrived — whoever asked first is at the top.
        </p>
      </section>

      {loading && <p>Loading...</p>}

      {error && <p className="form-error">{error}</p>}

      {!loading && !error && requests.length === 0 && (
        <p>No requests yet on your posted rides.</p>
      )}

      <section className="trips-list">
        {requests.map((r) => (
          <article key={r.id} className={`trip-card trip-card--${r.status}`}>
            <div className="queue-position">
              <span>#{r.position}</span>
              <small>in line</small>
            </div>

            <div className="trip-route">
              <div>
                <small>FROM</small>
                <strong>{r.ride?.pickup}</strong>
              </div>
              <div className="trip-line">─────────→</div>
              <div>
                <small>TO</small>
                <strong>{r.ride?.dropoff}</strong>
              </div>
            </div>

            <div className="trip-person">
              <div className="avatar">
                {r.riderName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <strong>{r.riderName}</strong>
                <span>
                  {r.status === "pending" ? "wants to join" : r.status} ·{" "}
                  {new Date(r.createdAt).toLocaleString([], {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>

            <span className={`status-badge status-${r.status}`}>{r.status}</span>

            {r.status === "pending" && (
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  disabled={answering != null}
                  onClick={() => updateStatus(r, "declined")}
                >
                  Decline
                </button>

                <button
                  className="primary-button"
                  disabled={answering != null || r.seatsLeft === 0}
                  onClick={() => updateStatus(r, "accepted")}
                >
                  {r.seatsLeft === 0 ? "No seats left" : "Accept →"}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
