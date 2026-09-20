import React, { useState, useEffect } from "react";
import { api } from "./lib/api";
import ReportTrip from "./ReportTrip";
import { formatFare, fareNote } from "./lib/fare";

export default function MyTrips({ onViewTrip, onTrackTrip }) {
  // The trip a report is being written about, or null.
  const [reporting, setReporting] = useState(null);

  const [tab, setTab] = useState("upcoming");
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(null);

  useEffect(() => {
    loadTrips();

    const interval = setInterval(() => {
      loadTrips(true);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const loadTrips = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }

    try {
      // The server joins rides, drivers and requests together and only
      // returns trips belonging to the signed-in user.
      setTrips(await api.requests.mine());
      setError("");
    } catch (err) {
      setError(err.message);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Call off a seat, requested or accepted.
   *
   * The row is removed rather than marked cancelled, so the seat goes
   * back on the board and this rider is free to ask again later.
   */
  const cancelTrip = async (trip) => {
    if (cancelling) return;

    setCancelling(trip.tripId);

    try {
      await api.requests.cancel(trip.tripId);
      await loadTrips(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(null);
    }
  };

  // The API decides where a trip stands and returns the list already in
  // the order a rider wants it: whatever is happening now first, then what
  // they have to be somewhere for, then the past. Nothing is re-sorted
  // here — two sort orders for one list is how they drift apart.
  //
  // The fallback covers an older API that sends no state: everything that
  // is not declined stays in Upcoming, which is exactly what this page did
  // before.
  const state = (trip) =>
    trip.state || (trip.status === "declined" ? "declined" : "upcoming");

  const upcoming = trips.filter((t) => ["live", "upcoming"].includes(state(t)));
  const history = trips.filter((t) => ["finished", "declined"].includes(state(t)));

  // The one trip that is actually under way, if there is one.
  const liveTrip = trips.find((t) => state(t) === "live") || null;

  const reportModal = reporting ? (
    <ReportTrip
      tripId={reporting.tripId}
      role="rider"
      withName={reporting.person}
      onClose={() => setReporting(null)}
    />
  ) : null;

  return (
    <>
      {reportModal}
      <main className="page-shell">

      <section className="page-heading">
        <div>
          <span className="eyebrow">MY TRIPS</span>

          <h1>
            Your rides,
            <br />
            <em>all in one place.</em>
          </h1>

          <p>
            Keep track of your upcoming commutes
            and the rides you've requested.
          </p>
        </div>
      </section>

      {/* The way back in.
          Closing the live map used to be a one-way door: the trip was
          still running, the driver was still on their way, and the only
          route back was to find the right card and hope. A journey that
          is actually under way is the one thing on this page that cannot
          wait, so it says so at the top and reopens in one tap — from
          either tab, before anything else is read. */}
      {liveTrip && (
        <section className="live-now">
          <div>
            <span className="eyebrow">HAPPENING NOW</span>

            <strong>
              {liveTrip.tripStatus === "arrived"
                ? `${liveTrip.person} has arrived`
                : liveTrip.tripStatus === "started"
                  ? `On the way to ${liveTrip.dropoff}`
                  : `${liveTrip.person} is coming to you`}
            </strong>

            <span className="live-now-where">
              {liveTrip.pickup} → {liveTrip.dropoff}
            </span>
          </div>

          <button
            className="primary-button"
            onClick={() => onTrackTrip?.(liveTrip)}
          >
            Open live map →
          </button>
        </section>
      )}

      <div className="trip-tabs">

        <button
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          Upcoming
        </button>

        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          History
        </button>

      </div>

      {loading && <p>Loading...</p>}

      {error && <p className="form-error">{error}</p>}

      {!loading && tab === "upcoming" ? (

        <section className="trip-list">

          {upcoming.length === 0 ? (

            <section className="empty-trips">
              <div className="empty-sticker">HOP</div>
              <h2>No rides yet.</h2>
              <p>
                Find a ride and request a seat.
                Your upcoming commute will appear here.
              </p>
            </section>

          ) : (

            upcoming.map((trip) => (

              <article
                className={`trip-card ${state(trip) === "live" ? "trip-card--live" : ""}`}
                key={trip.tripId}
              >

                <div className="trip-date">
                  <span>{trip.date}</span>
                  <strong>{trip.time}</strong>
                </div>

                <div className="trip-route">
                  <div>
                    <small>FROM</small>
                    <strong>{trip.pickup}</strong>
                  </div>

                  <div className="trip-line">─────────→</div>

                  <div>
                    <small>TO</small>
                    <strong>{trip.dropoff}</strong>
                  </div>
                </div>

                <div className="trip-person">
                  <div className="avatar">
                    {trip.person?.slice(0, 2).toUpperCase()}
                  </div>

                  <div>
                    <strong>{trip.person}</strong>
                    <span>
                      {trip.role} · {trip.vehicle}
                      {trip.status === "accepted" && trip.vehicleNumber
                        ? ` · ${trip.vehicleNumber}`
                        : ""}
                    </span>
                  </div>
                </div>

                <span className={`status-badge status-${trip.status}`}>
                  {trip.status}
                </span>

                {/* What this seat costs, on the trip it belongs to — the
                    same number the board showed when it was requested. */}
                {trip.fare && (
                  <p className="ride-fare ride-fare--inline">
                    <strong>{formatFare(trip.fare)}</strong>
                    <span>{fareNote(trip.fare)}</span>
                  </p>
                )}

                {/* The message a waiting rider is actually looking for. */}
                {trip.status === "accepted" && trip.tripStatus === "arrived" && (
                  <span className="arrived-badge">Your ride has arrived</span>
                )}

                {trip.status === "accepted" && trip.tripStatus === "started" && (
                  <span className="arrived-badge arrived-badge--moving">On the way</span>
                )}

                <div className="trip-card-actions">
                  <button
                    className="secondary-button"
                    onClick={() => onViewTrip(trip)}
                  >
                    View ride →
                  </button>

                  {/* Only once a driver has said yes is there a journey to
                      follow; before that there is nothing to track. */}
                  {trip.status === "accepted" && (
                    <button
                      className="primary-button"
                      onClick={() => onTrackTrip?.(trip)}
                    >
                      {state(trip) === "live" ? "Open live map →" : "Track live →"}
                    </button>
                  )}

                  {trip.status === "accepted" && trip.phone && (
                    <a className="secondary-button" href={`tel:${trip.phone}`}>
                      ☎ Call driver
                    </a>
                  )}

                  {/* Most problems are only obvious once the trip is
                      over, which is long after the live screen has been
                      closed. This is the way back to it. */}
                  {trip.status === "accepted" && (
                    <button
                      className="secondary-button"
                      onClick={() => setReporting(trip)}
                    >
                      Report a problem
                    </button>
                  )}

                  <button
                    className="danger-button"
                    disabled={cancelling === trip.tripId}
                    onClick={() => cancelTrip(trip)}
                  >
                    {cancelling === trip.tripId ? "Cancelling…" : "Cancel"}
                  </button>
                </div>

              </article>

            ))

          )}

        </section>

      ) : !loading ? (

        <section className="trip-list">
          {history.length === 0 ? (
            <section className="empty-trips">
              <div className="empty-sticker">✓</div>
              <h2>
                Your ride history
                <br />
                will live here.
              </h2>
              <p>
                Completed and declined CampusHop rides appear
                here for a week, in case you need to report one.
              </p>
            </section>
          ) : (
            history.map((trip) => (
              <article className="trip-card" key={trip.tripId}>
                <div className="trip-date">
                  <span>{trip.date || "—"}</span>
                  <strong>{trip.time || "—"}</strong>
                </div>

                {/* A ride the driver withdrew has no route left to show.
                    Saying so beats three empty fields, which is what this
                    card used to render. */}
                {trip.rideMissing ? (
                  <div className="trip-route">
                    <div>
                      <small>RIDE WITHDRAWN</small>
                      <strong>The driver removed this ride</strong>
                    </div>
                  </div>
                ) : (
                  <div className="trip-route">
                    <div>
                      <small>FROM</small>
                      <strong>{trip.pickup}</strong>
                    </div>
                    <div className="trip-line">─────────→</div>
                    <div>
                      <small>TO</small>
                      <strong>{trip.dropoff}</strong>
                    </div>
                  </div>
                )}
                <span className={`status-badge status-${trip.status}`}>
                  {trip.status}
                </span>

                {/* What this seat costs, on the trip it belongs to — the
                    same number the board showed when it was requested. */}
                {trip.fare && (
                  <p className="ride-fare ride-fare--inline">
                    <strong>{formatFare(trip.fare)}</strong>
                    <span>{fareNote(trip.fare)}</span>
                  </p>
                )}

                {/* The message a waiting rider is actually looking for. */}
                {trip.status === "accepted" && trip.tripStatus === "arrived" && (
                  <span className="arrived-badge">Your ride has arrived</span>
                )}

                {/* A trip that is over is exactly when a problem becomes
                    obvious — someone gets home and realises. Completed
                    trips live on this tab now, so the way to report one
                    has to be here rather than only on the tab they just
                    left. It stays for as long as the trip is kept. */}
                {trip.status === "accepted" && !trip.rideMissing && (
                  <div className="trip-card-actions">
                    <button
                      className="secondary-button"
                      onClick={() => onViewTrip(trip)}
                    >
                      View ride →
                    </button>

                    <button
                      className="secondary-button"
                      onClick={() => setReporting(trip)}
                    >
                      Report a problem
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </section>

      ) : null}

    </main>
    </>
  );
}