import React, { useEffect, useMemo, useState } from "react";
import VehicleIcon from "./VehicleIcon";
import { getCurrentLocation, formatDistance } from "./lib/geo";
import { withProximity } from "./lib/match";
import { formatFare } from "./lib/fare";
import { departed, dayLabel, requestState } from "./lib/rideState";

// Enough to scroll through, few enough that "nearest" still means near.
const SHOW = 10;

// Past this, the nearest ride is not near anyone. Said so, rather than
// captioning a ride across the city "near you".
const CLOSE_M = 5000;

/**
 * The rides passing closest to where you are right now.
 *
 * Distance is measured to the nearest point on each driver's *route*, not
 * to where they set off — a driver starting across town who drives down
 * your street is the ride you want, and ranking by start point would bury
 * them under someone leaving from next door in the wrong direction.
 *
 * Measured against the board the dashboard already polls, so this costs no
 * request of its own and stays current as seats fill and rides are posted.
 * Your position is asked for once, on arrival, and again only when you ask:
 * following it continuously would drain a phone to refine a list you are
 * glancing at.
 */
export default function NearbyRides({ rides, onRequest, pendingRideId, onBrowseAll }) {
  const [here, setHere] = useState(null);
  const [locating, setLocating] = useState(true);
  const [locateError, setLocateError] = useState("");

  // Bumped to ask again. The effect below is the only thing that reads the
  // device, so a retry is just "run it once more".
  const [attempt, setAttempt] = useState(0);

  // Straight away, without a button: the point of this strip is that it
  // is already showing something when you arrive.
  useEffect(() => {
    let cancelled = false;

    // Every write lands after the fix comes back, and none of them after
    // leaving the page — a slow GPS answer should not update a strip
    // nobody is looking at any more.
    getCurrentLocation()
      .then((position) => {
        if (cancelled) return;
        setHere(position);
        setLocateError("");
      })
      .catch((err) => !cancelled && setLocateError(err.message))
      .finally(() => !cancelled && setLocating(false));

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const locate = () => {
    setLocating(true);
    setLocateError("");
    setAttempt((n) => n + 1);
  };

  const nearest = useMemo(() => {
    if (!here || !rides?.length) return [];

    return withProximity(rides, here)
      .filter((ride) => {
        // Only what you could actually ask for, or already have.
        if (ride.isMine) return false;
        if (departed(ride)) return false;
        if (ride.myRequestStatus === "declined") return false;

        // A full ride is not an option — unless it is full because of you.
        if (ride.full && !ride.myRequestStatus) return false;

        // No route and no pickup pin means no distance, and a strip ordered
        // by distance has nowhere honest to put it.
        return ride.distanceFromMe != null;
      })
      .sort((a, b) => a.distanceFromMe - b.distanceFromMe)
      .slice(0, SHOW);
  }, [rides, here]);

  const closest = nearest[0]?.distanceFromMe;
  const farOff = closest != null && closest > CLOSE_M;

  return (
    <section className="nearby" aria-labelledby="nearby-title">
      <header className="nearby-head">
        <div>
          <span className="eyebrow">FROM WHERE YOU ARE</span>
          <h2 id="nearby-title">Rides near you</h2>

          <p className="nearby-where">
            {locating && "Finding your location…"}

            {!locating && here && (
              <>
                <span className="location-ping" aria-hidden="true" />
                {farOff
                  ? "Nothing passes close right now — these are the nearest."
                  : `Closest ride passes ${formatDistance(Math.round(closest ?? 0))} away`}
                {here.accuracy ? ` · located to ±${Math.round(here.accuracy)} m` : ""}
              </>
            )}
          </p>
        </div>

        <div className="nearby-controls">
          <button
            type="button"
            className="nearby-refresh"
            onClick={locate}
            disabled={locating}
          >
            {locating ? "Locating…" : "↻ Update location"}
          </button>

          {onBrowseAll && (
            <button type="button" className="nearby-all" onClick={onBrowseAll}>
              Search by route →
            </button>
          )}
        </div>
      </header>

      {/* Denied or unavailable. Said plainly, with the way forward, rather
          than an empty strip that looks like there are no rides at all. */}
      {!locating && locateError && (
        <div className="nearby-empty">
          <p>{locateError}</p>

          <div className="nearby-empty-actions">
            <button type="button" className="nearby-refresh" onClick={locate}>
              Try again
            </button>

            {onBrowseAll && (
              <button type="button" className="nearby-all" onClick={onBrowseAll}>
                Search by address instead →
              </button>
            )}
          </div>
        </div>
      )}

      {!locating && here && nearest.length === 0 && (
        <div className="nearby-empty">
          <p>
            No rides you could join right now. New ones appear here as
            drivers post them.
          </p>
        </div>
      )}

      {locating && !here && (
        <div className="nearby-line" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="nearby-card nearby-card--ghost" />
          ))}
        </div>
      )}

      {nearest.length > 0 && (
        <div className="nearby-line" role="list">
          {nearest.map((ride) => {
            const request = requestState(ride, pendingRideId === ride.id);
            const fare = formatFare(ride.fare);

            return (
              <article key={ride.id} className="nearby-card" role="listitem">
                <div className="nearby-card-top">
                  <span className="nearby-card-icon">
                    <VehicleIcon vehicle={ride.vehicle} size={24} />
                  </span>

                  <div className="nearby-card-who">
                    <strong>{ride.name}</strong>
                    <span>{ride.vehicle || "Vehicle"}</span>
                  </div>

                  <span className="nearby-away">
                    {formatDistance(Math.round(ride.distanceFromMe))}
                  </span>
                </div>

                <ol className="nearby-stops">
                  <li title={ride.pickup}>{ride.pickup}</li>
                  <li title={ride.dropoff}>{ride.dropoff}</li>
                </ol>

                <div className="nearby-facts">
                  <span>
                    {dayLabel(ride.date) || "—"} · {ride.time || "—"}
                  </span>

                  {/* Once one of the seats is yours, how many are left is
                      somebody else's question. */}
                  {ride.myRequestStatus === "accepted" ? (
                    <span>Your seat is confirmed</span>
                  ) : ride.myRequestStatus === "pending" ? (
                    <span>Waiting on the driver</span>
                  ) : (
                    ride.seatsLeft != null && (
                      <span>
                        {ride.seatsLeft} seat{ride.seatsLeft === 1 ? "" : "s"} left
                      </span>
                    )
                  )}
                </div>

                <div className="nearby-card-foot">
                  <strong className="nearby-fare">{fare || "—"}</strong>

                  <button
                    type="button"
                    className={`nearby-request nearby-request--${request.tone}`}
                    disabled={request.disabled}
                    onClick={() => onRequest(ride)}
                  >
                    {request.disabled ? request.label : "Request"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
