import React, { useEffect, useState } from "react";
import { api } from "./lib/api";
import Stars from "./Stars";
import RouteMap from "./RouteMap";
import { formatDistance, formatDuration } from "./lib/geo";
import { formatFare, fareNote, FARE_EXPLAINER } from "./lib/fare";
import RatePanel from "./RatePanel";

export default function RideDetails({ trip, onBack }) {
  // Hooks run before the early return below, so their order never changes.
  const [people, setPeople] = useState([]);
  useEffect(() => { let cancelled = false; if (trip?.rideId) api.community.ridePeople(trip.rideId).then(p => !cancelled && setPeople(p)).catch(() => {}); return () => { cancelled = true; }; }, [trip?.rideId]);

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
  const fare = formatFare(trip.fare);

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

            {fare && (
              <div>
                <small>YOUR SHARE</small>
                <strong>{fare}</strong>
              </div>
            )}
          </div>
        )}

        {/* Room here to say where the number comes from, which the card on
            the board has no space for. */}
        {fare && (
          <p className="fare-explainer">
            <strong>
              {fare} · {fareNote(trip.fare)}
            </strong>
            <span>{FARE_EXPLAINER}</span>
          </p>
        )}
      </section>

      <section className="people-youll-meet">
        <div className="card-kicker">THE HUMAN PART</div>
        <h2>You&apos;ll ride with</h2>
        <p>Different course? Different year? Same route. That&apos;s the CampusHop plot twist.</p>
        <div className="people-strip">
          {people.map(person => (
            <div className="person-chip" key={person.id}>
              <span className="avatar">{person.name?.slice(0,2).toUpperCase()}</span>
              <strong>{person.name}</strong>
              <small>{person.isDriver ? 'Driver' : (person.course || person.role || 'Campus member')}</small>
            </div>
          ))}
        </div>
      </section>

      {trip.tripStatus === "completed" && trip.tripId && (
        <RatePanel
          tripId={trip.tripId}
          role={trip.role === "Driver" || trip.role === "driver" ? "driver" : "rider"}
          withName={trip.person}
        />
      )}

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
          {/* This line has existed since before there was anything to put
              in it. There is now. */}
          <p className="trip-meta-rating">
            Rating:{" "}
            {trip.rating != null ? (
              <Stars value={trip.rating} count={trip.ratingCount} size="small" />
            ) : (
              <span className="stars stars--none">Not rated yet</span>
            )}
          </p>

          <p>Match score: {trip.score ?? "—"}%</p>
        </div>
      </section>
    </main>
  );
}
