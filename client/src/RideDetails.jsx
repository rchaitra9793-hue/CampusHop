import React from "react";
import RouteMap from "./RouteMap";
import { formatDistance, formatDuration } from "./lib/geo";

export default function RideDetails({ trip, onBack }) {
  if (!trip) {
    return (
      <main className="page-shell">
        <p>No ride selected.</p>
        <button className="secondary-button" onClick={onBack}>
          ← Back to My Trips
        </button>
      </main>
    );
  }

  const distance = formatDistance(trip.distanceMeters);
  const duration = formatDuration(trip.durationSeconds);

  return (
    <main className="page-shell">
      <button className="secondary-button" onClick={onBack}>
        ← Back to My Trips
      </button>

      <section className="page-heading">
        <span className="eyebrow">RIDE DETAILS</span>
        <h1>
          {trip.pickup} <em>→</em> {trip.dropoff}
        </h1>
        <p>{trip.date} · {trip.time}</p>
      </section>

      <section className="ride-map-panel">
        <RouteMap
          geometry={trip.routeGeometry}
          pickup={trip.pickup}
          dropoff={trip.dropoff}
          height={360}
        />

        {(distance || duration) && (
          <div className="ride-map-stats">
            {distance && (
              <div>
                <small>DISTANCE</small>
                <strong>{distance}</strong>
              </div>
            )}

            {duration && (
              <div>
                <small>DRIVE TIME</small>
                <strong>{duration}</strong>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="trip-card">
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
            <span>{trip.role} · {trip.vehicle}</span>
          </div>
        </div>

        <div className="trip-meta">
          <p>Rating: {trip.rating ?? "—"}</p>
          <p>Match score: {trip.score ?? "—"}%</p>
        </div>
      </section>
    </main>
  );
}
