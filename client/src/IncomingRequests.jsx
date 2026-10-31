import React, { useEffect, useState } from "react";
import ReportTrip from "./ReportTrip";
import Stars from "./Stars";
import TripChat from "./TripChat";
import { formatFare, fareNote } from "./lib/fare";
import { statusLabel } from "./lib/rideNotices";
import MemberStats from "./MemberStats";

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
  onCancel,
  nearby,
}) {
  // The request a report is being written about, or null.
  const [reporting, setReporting] = useState(null);

  const [answering, setAnswering] = useState(null);
  const [chatTrip, setChatTrip] = useState(null);

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

  // Everything stays listed — finished trips included, so they can still
  // be rated or reported. The server clears trips out once they are
  // TRIP_HISTORY_DAYS (7) days old.
  const active = requests;

  // Nothing to answer. Loading is not "nothing", and neither is an error.
  const quiet = !loading && !error && active.length === 0;

  useEffect(() => {
    if (!chatTrip) return;
    const current = requests.find((r) => r.id === chatTrip.id);
    if (current?.state === "finished") {
      setChatTrip(null);
    }
  }, [requests, chatTrip]);

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
      {chatTrip && (
        <div className="chat-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setChatTrip(null); }}>
          <div className="chat-modal-card">
            <button type="button" className="chat-modal-close" onClick={() => setChatTrip(null)} aria-label="Close messages">×</button>
            <TripChat tripId={chatTrip.id} withName={chatTrip.riderName} />
          </div>
        </div>
      )}
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
        {active.map((r) => (
          <article key={r.id} className={`trip-card request-card trip-card--${r.status}`}>
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
                  {r.status === "pending" ? "wants to join" : statusLabel(r.status)} ·{" "}
                  {new Date(r.createdAt).toLocaleString([], {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>

                {/* How other drivers found them. This is the one place it
                    matters most: it is on the screen where a driver is
                    deciding whether to say yes. */}
                {r.riderRating != null && (
                  <Stars
                    value={r.riderRating}
                    count={r.riderRatingCount}
                    size="small"
                  />
                )}

                {/* Their track record, where the driver decides. */}
                <MemberStats stats={r.riderStats} compact />

                {r.status === "accepted" && r.paymentStatus && r.state === "finished" && (
                  <span className={`pay-chip pay-chip--${r.paymentStatus}`}>
                    {r.paymentStatus === "confirmed"
                      ? `Paid${r.paymentMethod ? ` · ${r.paymentMethod.toUpperCase()}` : ""}`
                      : r.paymentStatus === "paid"
                        ? "Rider says paid — confirm"
                        : "Not paid yet"}
                  </span>
                )}
              </div>
            </div>

            <span
              className={`status-badge status-${r.expired ? "expired" : r.status}`}
            >
              {r.expired ? "expired" : statusLabel(r.status)}
            </span>

            {/* The driver sees exactly what the rider sees. Two different
                numbers is how an argument at the kerb starts — and with a
                split there is only one number anyway: they each carry the
                same half of what the journey costs. */}
            {/* Fare and rating share one row, side by side, rather than
                two elements drawn into the same grid cell on top of each
                other. */}
            <div className="request-meta">
              {r.fare && (
                <p className="ride-fare ride-fare--inline">
                  <strong>{formatFare(r.fare)}</strong>
                  <span>{fareNote(r.fare)} · each</span>
                </p>
              )}

              {r.myRating != null && (
                <p className="trip-rated">
                  You rated this <Stars value={r.myRating} size="small" />
                </p>
              )}
            </div>

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

                {/* A trip that is over has no live map worth opening,
                    but it does have a summary: what the journey cost,
                    which half each of them carries, and the rating.
                    Reopening it is the way back to all three — a rating
                    collected on the end-of-ride screen needs that screen
                    to still be reachable once the screen has been closed.

                    Quietly styled on purpose. The loud button on this card
                    belongs to the trip still happening, not to one that
                    finished last week. */}
                {r.state === "finished" && onOpenLive && (
                  <button
                    className="secondary-button"
                    onClick={() => onOpenLive(r)}
                  >
                    {r.myRating == null ? "Rate this trip →" : "Trip summary →"}
                  </button>
                )}

                {/* A driver has the same right to report a trip as the
                    rider does: someone who never turned up, or who behaved
                    badly in the vehicle, is the driver's problem to raise. */}
                {r.state !== "finished" && (
                  <button
                    className="secondary-button request-message-button"
                    onClick={() => setChatTrip(r)}
                  >
                    💬 Message {r.riderName}
                  </button>
                )}

                <button
                  className="secondary-button"
                  onClick={() => setReporting(r)}
                >
                  Report a problem
                </button>

                {/* The driver can call the ride off at any time until it
                    is completed; the rider is told straight away. */}
                {r.state !== "finished" && r.tripStatus !== "completed" && onCancel && (
                  <button
                    className="danger-button"
                    onClick={() => onCancel(r)}
                  >
                    Cancel ride
                  </button>
                )}
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
