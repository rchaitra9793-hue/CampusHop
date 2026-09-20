import React, { useEffect, useState } from "react";
import AddressInput from "./AddressInput";
import RideCard from "./RideCard";
import RouteMap from "./RouteMap";
import {
  computeRoute,
  formatDistance,
  formatDuration,
  getCurrentLocation,
  reverseGeocode,
} from "./lib/geo";
import { api } from "./lib/api";
import { WEIGHTS } from "./lib/match";
import { upcoming } from "./lib/rideState";

// How often the board re-checks itself against the clock. The API decides
// what is on the board and this page re-fetches whenever the dashboard's
// poll turns up something new, so this is only for the ride that runs out
// while nothing else changes — a page left open across an 08:00 departure
// should not still be offering the 08:00 seat at 08:04.
const EXPIRY_TICK_MS = 30000;

export default function FindRide({ rides, onRequest, initialSearch, pendingRideId = null }) {
  const [requested, setRequested] = useState(null);

  const [fromPlace, setFromPlace] = useState(initialSearch?.from ?? null);
  const [toPlace, setToPlace] = useState(initialSearch?.to ?? null);
  const [arriveBy, setArriveBy] = useState(initialSearch?.arriveBy ?? "08:30");
  const [vehicle, setVehicle] = useState("any");

  // Where the rider actually is, from the browser. Used to order the
  // board by how close each ride passes — never to hide one.
  const [myLocation, setMyLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  const [myRoute, setMyRoute] = useState(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState("");

  const [highlighted, setHighlighted] = useState(null);

  // --- location ----------------------------------------------------------

  const locate = async ({ fillFrom = false } = {}) => {
    setLocating(true);
    setLocationError("");

    try {
      const position = await getCurrentLocation();
      setMyLocation(position);

      if (fillFrom) {
        // Name the spot so the search field reads sensibly; the exact
        // fix is kept either way.
        const place = await reverseGeocode(position.lat, position.lng);

        setFromPlace(
          place ?? {
            label: "My current location",
            context: "",
            lat: position.lat,
            lng: position.lng,
          }
        );
      }
    } catch (err) {
      setLocationError(err.message);
      setMyLocation(null);
    } finally {
      setLocating(false);
    }
  };

  // Ask once when the page opens. A refusal is not an error state — the
  // board simply stays unfiltered.
  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- the rider's own route (the only routing call on this page) --------

  useEffect(() => {
    if (!fromPlace || !toPlace) {
      setMyRoute(null);
      setRouteError("");
      return;
    }

    let cancelled = false;

    const run = async () => {
      setRouting(true);
      setRouteError("");

      try {
        const result = await computeRoute(fromPlace, toPlace);
        if (!cancelled) setMyRoute(result);
      } catch (err) {
        if (!cancelled) {
          setRouteError(err.message);
          setMyRoute(null);
        }
      } finally {
        if (!cancelled) setRouting(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [fromPlace, toPlace]);

  // --- results, ranked by the server ------------------------------------

  const [board, setBoard] = useState({ rides: [], total: 0, searched: false });
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [boardError, setBoardError] = useState("");

  const searching = Boolean(fromPlace && toPlace);

  // Ranking, distance and the reliability signal are all computed by the
  // API, which returns every ride. The client sends what the rider asked
  // for and renders the order it gets back.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoadingBoard(true);

      try {
        const result = await api.rides.list({
          fromLat: fromPlace?.lat,
          fromLng: fromPlace?.lng,
          toLat: toPlace?.lat,
          toLng: toPlace?.lng,
          arriveBy,
          vehicle: vehicle === "any" ? undefined : vehicle,
          lat: myLocation?.lat,
          lng: myLocation?.lng,
        });

        if (!cancelled) {
          setBoard(result);
          setBoardError("");
        }
      } catch (err) {
        if (!cancelled) {
          setBoardError(err.message);
          setBoard({ rides: [], total: 0, searched: false });
        }
      } finally {
        if (!cancelled) setLoadingBoard(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [rides, fromPlace, toPlace, arriveBy, vehicle, myLocation]);

  // Re-renders on a timer so a ride that reaches its departure while this
  // page is open drops off it, rather than waiting for the next search or
  // a reload to notice.
  const [, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), EXPIRY_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // The API has already ended the board at each ride's departure; this is
  // the same rule applied to the copy this page is holding, which was true
  // when it arrived and goes stale by the second.
  const visible = upcoming(board.rides);

  const best = searching ? visible[0] : null;

  const highlightedRide =
    visible.find((r) => r.id === highlighted) || (searching ? best : null);

  // --- map layers --------------------------------------------------------

  const mapRoutes = [];

  if (myRoute) {
    mapRoutes.push({
      id: "mine",
      geometry: myRoute.geometry,
      color: "#b4a7e5",
      width: 5,
      dashed: true,
    });
  }

  if (highlightedRide?.routeGeometry) {
    mapRoutes.push({
      id: "theirs",
      geometry: highlightedRide.routeGeometry,
      color: "#ff8fa3",
      width: 4.5,
    });
  }

  const mapMarkers = [];

  if (myLocation) {
    mapMarkers.push({
      lngLat: [myLocation.lng, myLocation.lat],
      kind: "me",
      label: "You are here",
    });
  }

  if (fromPlace) {
    mapMarkers.push({
      lngLat: [fromPlace.lng, fromPlace.lat],
      kind: "pickup",
      label: `From: ${fromPlace.label}`,
    });
  }

  if (toPlace) {
    mapMarkers.push({
      lngLat: [toPlace.lng, toPlace.lat],
      kind: "dropoff",
      label: `To: ${toPlace.label}`,
    });
  }

  const clearSearch = () => {
    setFromPlace(null);
    setToPlace(null);
    setMyRoute(null);
    setHighlighted(null);
  };

  return (
    <main className="page-shell">

      <section className="page-heading">
        <div>
          <span className="eyebrow">FIND A RIDE</span>

          <h1>
            Someone&apos;s already
            <br />
            <em>heading your way.</em>
          </h1>

          <p>
            Every ride on the board, ranked by how well it fits your
            commute — however far away it sets off.
          </p>
        </div>
      </section>

      {/* --- location bar --- */}

      <section className="location-bar">
        {locating && <span className="location-state">Finding your location…</span>}

        {!locating && myLocation && (
          <>
            <span className="location-state location-state--ok">
              <span className="location-ping" />
              Located
              {myLocation.accuracy && ` · ±${Math.round(myLocation.accuracy)} m`}
            </span>

            <button
              type="button"
              className="text-button"
              onClick={() => locate({ fillFrom: true })}
            >
              Use my location as pickup
            </button>
          </>
        )}

        {!locating && !myLocation && (
          <>
            <span className="location-state location-state--off">
              {locationError || "Location off — rides won't be sorted by distance."}
            </span>

            <button type="button" className="text-button" onClick={() => locate()}>
              Enable location
            </button>
          </>
        )}
      </section>

      {/* --- search --- */}

      <section className="search-panel search-panel--live">

        <AddressInput
          label="From"
          name="from"
          placeholder="e.g. BTM Layout"
          mapTitle="Where are you starting from?"
          value={fromPlace}
          onChange={setFromPlace}
        />

        <AddressInput
          label="To"
          name="to"
          placeholder="e.g. BMS College of Engineering"
          mapTitle="Where are you going?"
          value={toPlace}
          onChange={setToPlace}
        />

        <label className="search-field">
          Arrive by
          <input
            type="time"
            value={arriveBy}
            onChange={(e) => setArriveBy(e.target.value)}
          />
        </label>

        <label className="search-field">
          Vehicle
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="any">Any</option>
            <option value="car">Car</option>
            <option value="bike">Bike</option>
            <option value="scooty">Scooty</option>
          </select>
        </label>

        {searching && (
          <button type="button" className="text-button" onClick={clearSearch}>
            Clear
          </button>
        )}

      </section>

      {routing && <p className="route-status">Mapping your route…</p>}

      {routeError && <p className="form-error">{routeError}</p>}

      {boardError && <p className="form-error">{boardError}</p>}

      {(myRoute || highlightedRide || myLocation) && (
        <section className="ride-map-panel">
          <RouteMap
            routes={mapRoutes}
            markers={mapMarkers}
            height={340}
          />

          <div className="map-legend">
            {myLocation && (
              <span className="legend-item legend-item--me">You are here</span>
            )}

            {myRoute && (
              <span className="legend-item legend-item--mine">Your route</span>
            )}

            {highlightedRide && (
              <span className="legend-item legend-item--theirs">
                {highlightedRide.name}
                {highlightedRide.score != null && ` · ${highlightedRide.score}% match`}
              </span>
            )}
          </div>

          <div className="ride-map-stats">
            {myRoute && (
              <>
                <div>
                  <small>YOUR TRIP</small>
                  <strong>{formatDistance(myRoute.distanceMeters)}</strong>
                </div>

                <div>
                  <small>DRIVE TIME</small>
                  <strong>{formatDuration(myRoute.durationSeconds)}</strong>
                </div>
              </>
            )}

            <div>
              <small>RIDES ON BOARD</small>
              <strong>{visible.length}</strong>
            </div>
          </div>
        </section>
      )}

      <section className="matches-header">
        <div>
          <span className="eyebrow">
            {searching ? "RANKED FOR YOU" : "TODAY'S ROUTES"}
          </span>
          <h2>
            {searching ? "Best matches for you." : "Every route on campus."}
          </h2>
        </div>

        <div className="match-explanation">
          <div className="tiny-score">{best?.score ?? visible.length}</div>

          <span>
            Scored on route {Math.round(WEIGHTS.route * 100)}%, time{" "}
            {Math.round(WEIGHTS.time * 100)}%,
            <br />
            pickup {Math.round(WEIGHTS.pickup * 100)}% and reliability{" "}
            {Math.round(WEIGHTS.reliability * 100)}%.
          </span>
        </div>
      </section>

      <section className="ride-board">

        <div className="board-scribble">
          <span>{searching ? "best fit first" : "closest first"}</span>
          <div>↘</div>
        </div>

        {loadingBoard && visible.length === 0 && (
          <p className="route-status">Loading rides…</p>
        )}

        {!loadingBoard && visible.length === 0 && (
          <section className="empty-trips">
            <div className="empty-sticker">HOP</div>

            <h2>No rides posted yet.</h2>

            <p>Once someone offers a ride, it will show up here.</p>
          </section>
        )}

        {visible.map((ride) => (
          <div
            key={ride.id}
            className={`ride-card-slot ${
              highlightedRide?.id === ride.id ? "ride-card-slot--active" : ""
            }`}
            onMouseEnter={() => setHighlighted(ride.id)}
            onFocus={() => setHighlighted(ride.id)}
          >
            <RideCard
              ride={ride}
              onRequest={setRequested}
              pending={pendingRideId === ride.id}
            />
          </div>
        ))}

      </section>

      {requested && !requested.isMine && !requested.myRequestStatus && (
        <div className="modal-backdrop" onClick={() => setRequested(null)}>
          <div className="request-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-sticker">HOP!</div>

            <span className="eyebrow">RIDE REQUEST</span>

            <h2>Send a request to {requested.name}?</h2>

            <p>
              You&apos;re requesting the {requested.vehicle?.toLowerCase()} from{" "}
              {requested.pickup} at {requested.time}.
              {requested.distanceFromMe != null &&
                ` That route passes about ${formatDistance(
                  Math.round(requested.distanceFromMe)
                )} from you.`}
            </p>

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setRequested(null)}
              >
                Not yet
              </button>

              <button
                className="primary-button"
                disabled={pendingRideId != null}
                onClick={() => {
                  onRequest(requested);
                  setRequested(null);
                }}
              >
                {pendingRideId != null ? "Sending…" : "Send request →"}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
