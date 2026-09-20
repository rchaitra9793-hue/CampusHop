import React from "react";
import RouteIllustration from "./RouteIllustration";
import { formatDistance, formatDuration } from "./lib/geo";
import { formatFare, fareNote } from "./lib/fare";
import { dayLabel, requestState } from "./lib/rideState";
import { formatClock } from "./lib/match";

// The match sticker only appears once a search has actually scored the
// ride — an unscored board shows no percentage rather than a made-up one.
function ScoreSticker({ score }) {
  if (score == null) return null;

  return (
    <div className="score-sticker">
      <strong>{score}%</strong>
      <span>match</span>
    </div>
  );
}

function walkLabel(meters) {
  if (meters == null) return null;
  if (meters < 100) return "at your door";
  if (meters < 1000) return `${meters} m walk`;
  return `${(meters / 1000).toFixed(1)} km walk`;
}

/** How close this ride's route passes to the rider's actual position. */

/** The departure day, stated plainly next to the rest of the card. */
function DayTag({ date }) {
  const label = dayLabel(date);

  if (!label) return null;

  const when = new Date(`${date}T00:00`);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const days = Number.isNaN(when.getTime())
    ? null
    : Math.round((when.getTime() - midnight.getTime()) / 86400000);

  // Today reads differently from "some day next week", so it is coloured
  // differently rather than left for the reader to work out.
  const tone = days === 0 ? "today" : days < 0 ? "past" : "ahead";

  return <div className={`day-tag day-tag--${tone}`}>{label}</div>;
}

function ProximityTag({ meters }) {
  if (meters == null) return null;

  return (
    <div className="proximity-tag">
      {meters < 150
        ? "passes right by you"
        : `${formatDistance(Math.round(meters))} from you`}
    </div>
  );
}

/** Plain-language reasons behind the score, from the real geometry. */
function MatchNotes({ detail }) {
  if (!detail) return null;

  const notes = [];

  const walk = walkLabel(detail.walkToPickupM);
  if (walk) notes.push(walk);

  if (detail.arrivesAtMin != null) {
    notes.push(`arrives ${formatClock(detail.arrivesAtMin)}`);
  }

  if (detail.rightDirection === false) {
    notes.push("opposite direction");
  }

  if (notes.length === 0) return null;

  return (
    <div className={`match-notes ${detail.rightDirection === false ? "match-notes--warn" : ""}`}>
      {notes.join(" · ")}
    </div>
  );
}


export default function RideCard({ ride, onRequest, showMore = false, pending = false }) {
  const distance = formatDistance(ride.distanceMeters);
  const fare = formatFare(ride.fare);
  const duration = formatDuration(ride.durationSeconds);

  const request = requestState(ride, pending);

  return (
    <article
      className={`ride-card ride-card--${ride.accent}`}
      style={{ "--rotation": ride.rotation }}
    >
      <div className="washi-tape" />

      <ScoreSticker score={ride.score} />

      <div className="ride-card-top">
        <div className="avatar">{ride.initials}</div>

        <div className="rider-info">
          <strong>{ride.name}</strong>
          <span>
            {ride.role} · {ride.vehicle}
          </span>
        </div>

        {showMore && <button className="more-button">•••</button>}
      </div>

      <div className="ride-tags">
        <DayTag date={ride.date} />
        <ProximityTag meters={ride.distanceFromMe} />
      </div>

      <RouteIllustration
        compact
        pickup={ride.pickup}
        dropoff={ride.dropoff}
      />

      <MatchNotes detail={ride.matchDetail} />

      <div className="ride-meta">
        <div>
          <span>DEPARTS</span>
          <strong>{ride.time || "—"}</strong>
          <small className="ride-meta-day">{dayLabel(ride.date) || "—"}</small>
        </div>

        <div>
          <span>DISTANCE</span>
          <strong>{distance || "—"}</strong>
        </div>

        <div>
          <span>{duration ? "DRIVE" : "SEATS"}</span>
          <strong>{duration || ride.seats}</strong>
        </div>

        {ride.seatsLeft != null && (
          <div>
            <span>SEATS LEFT</span>
            <strong>
              {ride.seatsLeft} / {ride.seats}
            </strong>
          </div>
        )}
      </div>

      {/* The number a rider actually decides on, so it is not buried in
          the grid above with the ones they merely glance at. */}
      {fare && (
        <p className="ride-fare">
          <strong>{fare}</strong>
          <span>{fareNote(ride.fare)}</span>
        </p>
      )}

      <button
        className={`request-button request-button--${request.tone}`}
        onClick={() => onRequest(ride)}
        disabled={request.disabled}
      >
        {request.label}
        {!request.disabled && <span>↗</span>}
      </button>
    </article>
  );
}
