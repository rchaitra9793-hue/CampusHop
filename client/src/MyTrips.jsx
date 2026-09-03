import React, { useState, useEffect } from "react";
import { api } from "./lib/api";

export default function MyTrips({ onViewTrip, onTrackTrip }) {
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

  const upcoming = trips.filter((t) => t.status !== "declined");
  const history = trips.filter((t) => t.status === "declined");

  return (
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

              <article className="trip-card" key={trip.tripId}>

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
                      Track live →
                    </button>
                  )}

                  {trip.status === "accepted" && trip.phone && (
                    <a className="secondary-button" href={`tel:${trip.phone}`}>
                      ☎ Call driver
                    </a>
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
                Declined or completed CampusHop rides will
                appear here.
              </p>
            </section>
          ) : (
            history.map((trip) => (
              <article className="trip-card" key={trip.tripId}>
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
                <span className={`status-badge status-${trip.status}`}>
                  {trip.status}
                </span>

                {/* The message a waiting rider is actually looking for. */}
                {trip.status === "accepted" && trip.tripStatus === "arrived" && (
                  <span className="arrived-badge">Your ride has arrived</span>
                )}

                {trip.status === "accepted" && trip.tripStatus === "started" && (
                  <span className="arrived-badge arrived-badge--moving">On the way</span>
                )}
              </article>
            ))
          )}
        </section>

      ) : null}

    </main>
  );
}