import React, { useState } from "react";
import ReportTrip from "./ReportTrip";
import { formatFare, fareNote } from "./lib/fare";

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
  onOpenLive,
  nearby,
}) {
  // The request a report is being written about, or null.
  const [reporting, setReporting] = useState(null);

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

  // Nothing to answer. Loading is not "nothing", and neither is an error.
  const quiet = !loading && !error && requests.length === 0;

  const reportModal = reporting ? (
    <ReportTrip
      tripId={reporting.id}
      role="driver"
      withName={reporting.riderName}
      onClose={() => setReporting(null)}
    />
  ) : null;

  return (
    <>
      {reportModal}
      <main className="page-shell">
      {/* Someone with nobody asking to ride with them is, on this page,
          almost always someone looking for a ride themselves. For them the
          rides nearby are the page, and a driver's empty queue is a footnote.
          Once there are requests to answer, those come first — a waiting
          rider matters more than browsing. */}
      {quiet && nearby}

      {!quiet && (
        <section className="page-heading">
          <span className="eyebrow">INCOMING REQUESTS</span>
          <h1>People want to ride with you.</h1>
          <p>
            Accept or decline requests for rides you&apos;ve posted. They are
            listed in the order they arrived — whoever asked first is at the top.
          </p>
        </section>
      )}

      {loading && <p>Loading...</p>}

      {error && <p className="form-error">{error}</p>}

      {quiet && (
        <p className="requests-quiet">
          No one has asked to join a ride you&apos;ve posted. Requests will
          appear here when they do.
        </p>
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

            <span
              className={`status-badge status-${r.expired ? "expired" : r.status}`}
            >
              {r.expired ? "expired" : r.status}
            </span>

            {/* The driver sees exactly what the rider was quoted. Two
                different numbers is how an argument at the kerb starts. */}
            {r.fare && (
              <p className="ride-fare ride-fare--inline">
                <strong>{formatFare(r.fare)}</strong>
                <span>{fareNote(r.fare)} · rider contributes</span>
              </p>
            )}

            {r.status === "accepted" && (
              <div className="modal-actions">
                {/* The way back to the live map.
                    Accepting opens it once, and closing it used to be the
                    end of the matter — the driver was on their way to
                    somebody with no route back to the screen showing where
                    that somebody was standing. A trip that is still a
                    journey can be reopened from here as many times as it
                    takes. A finished one cannot: there is no live map
                    worth opening for a trip that is over. */}
                {r.state !== "finished" && onOpenLive && (
                  <button
                    className="primary-button"
                    onClick={() => onOpenLive(r)}
                  >
                    {r.tripStatus && r.tripStatus !== "scheduled"
                      ? "Open live map →"
                      : "Start the trip →"}
                  </button>
                )}

                {/* A driver has the same right to report a trip as the
                    rider does: someone who never turned up, or who behaved
                    badly in the vehicle, is the driver's problem to raise. */}
                <button
                  className="secondary-button"
                  onClick={() => setReporting(r)}
                >
                  Report a problem
                </button>
              </div>
            )}

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

      {!quiet && !loading && nearby}
    </main>
    </>
  );
}
