import React, { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps, createHtmlMarker, mapId } from "./lib/maps";
import { api } from "./lib/api";
import { computeRoute, formatDistance, formatDuration } from "./lib/geo";
import { vehicleIcon } from "./lib/vehicles";

const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

// Close enough to be looking at each other rather than at a screen.
const ARRIVED_M = 60;

// The driver's position goes to the server on this cadence. Often enough
// that a rider watching sees a car move; rarely enough to be a write
// every few seconds rather than every GPS tick.
const REPORT_EVERY_MS = 5000;
const REPORT_EVERY_M = 20;

// The rider reads it back a little faster than it is written, so a fix is
// never sitting unseen for long.
const POLL_LIVE_MS = 4000;

// Re-routing to the pickup costs an OpenRouteService call, so it happens
// when the road actually changed — not on every position fix.
const REROUTE_AFTER_M = 150;
const REROUTE_EVERY_MS = 20000;

function metresBetween(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b, in degrees clockwise from north. */
function bearingBetween(a, b) {
  const y = Math.sin((b.lng - a.lng) * DEG) * Math.cos(b.lat * DEG);
  const x =
    Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) -
    Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lng - a.lng) * DEG);

  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Arrows laid along a route so the direction of travel is visible.
 *
 * Drawn as DOM markers rather than a symbol layer: a text symbol depends
 * on the glyph being present in the style's font, and a missing glyph
 * fails silently — an arrow that is simply not there.
 */
function directionArrows(coordinates, wanted = 9) {
  if (!coordinates || coordinates.length < 2) return [];

  const step = Math.max(1, Math.floor(coordinates.length / (wanted + 1)));
  const arrows = [];

  for (let i = step; i < coordinates.length - 1; i += step) {
    const from = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const to = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };

    arrows.push({ at: coordinates[i], heading: bearingBetween(from, to) });
  }

  return arrows;
}

const toLatLng = ([lng, lat]) => ({ lat, lng });

/**
 * The live view of an accepted ride.
 *
 * A trip has two legs and they are not the same journey. First the driver
 * has to reach the pickup point, which is a route the ride itself knows
 * nothing about — it is computed from wherever the driver happens to be
 * when they set off. Only once the two people have actually met does the
 * stored route become the thing worth following.
 *
 * The driver's position is written to the server as they move and read
 * back by the riders they accepted, so a rider at a kerb watches the car
 * approach rather than refreshing a list. Nobody else can read it.
 */
export default function LiveRide({
  rideId,
  requestId,
  role = "driver",
  withName,
  onBack,
  onCancelled,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerClassRef = useRef(null);

  const meMarkerRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const pickupLineRef = useRef(null);
  const trailLineRef = useRef(null);
  const rideLineRef = useRef(null);
  const rideArrowsRef = useRef([]);

  const followRef = useRef(true);
  const lastFixRef = useRef(null);
  const lastReportRef = useRef({ at: 0, point: null });
  const lastRouteRef = useRef({ at: 0, from: null });

  const [ride, setRide] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [contact, setContact] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busyStatus, setBusyStatus] = useState(false);

  const [me, setMe] = useState(null);
  const [heading, setHeading] = useState(0);
  const [trail, setTrail] = useState([]);
  const [geoError, setGeoError] = useState("");
  const [following, setFollowing] = useState(true);

  const [tripStatus, setTripStatus] = useState("scheduled");
  const [driverLive, setDriverLive] = useState(null);
  const [pickupRoute, setPickupRoute] = useState(null);
  const [routingPickup, setRoutingPickup] = useState(false);

  const isDriver = role === "driver";
  const started = tripStatus === "started";
  const finished = tripStatus === "completed";

  // --- the ride ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    api.rides
      .get(rideId)
      .then((r) => {
        if (cancelled) return;
        setRide(r);
        setTripStatus(r.tripStatus || "scheduled");
      })
      .catch((err) => !cancelled && setLoadError(err.message));

    return () => {
      cancelled = true;
    };
  }, [rideId]);

  const pickup =
    ride?.pickupLat != null ? { lat: ride.pickupLat, lng: ride.pickupLng } : null;

  // --- who you are meeting ----------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // The two sides read their counterpart from different endpoints:
        // a driver's rider is on the incoming queue, a rider's driver is
        // on their own trips.
        if (isDriver) {
          const incoming = await api.requests.incoming();
          const match = incoming.find((r) => r.id === requestId);

          if (!cancelled && match) {
            setContact({ name: match.riderName, phone: match.riderPhone });
          }
        } else {
          const trips = await api.requests.mine();
          const match = trips.find((t) => t.tripId === requestId || t.rideId === rideId);

          if (!cancelled && match) {
            setContact({ name: match.person, phone: match.phone });
          }
        }
      } catch {
        // Not fatal: the map is the point, contact details are a bonus.
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [isDriver, requestId, rideId]);

  // --- your own position, as you move -----------------------------------

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("This browser cannot report your location.");
      return;
    }

    if (!window.isSecureContext) {
      setGeoError("Live location needs a secure connection (localhost or https).");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };

        // A phone at a standstill reports no heading, so fall back to the
        // direction actually travelled since the last fix.
        if (Number.isFinite(position.coords.heading)) {
          setHeading(position.coords.heading);
        } else if (lastFixRef.current && metresBetween(lastFixRef.current, next) > 8) {
          setHeading(bearingBetween(lastFixRef.current, next));
        }

        // The breadcrumb trail. Only real movement is recorded, so a
        // phone jittering on a table does not draw a scribble.
        setTrail((current) => {
          const previous = current[current.length - 1];

          if (previous && metresBetween(previous, next) < 15) return current;

          return [...current, next];
        });

        lastFixRef.current = next;
        setMe(next);
        setGeoError("");
      },
      (err) => {
        const messages = {
          1: "Location permission denied — turn it on to follow the route live.",
          2: "Your location is unavailable right now.",
          3: "Finding your location is taking a while.",
        };

        setGeoError(messages[err.code] || "Could not follow your location.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // --- the driver publishes where they are ------------------------------

  useEffect(() => {
    if (!isDriver || !me || finished) return;

    const now = Date.now();
    const { at, point } = lastReportRef.current;

    const moved = !point || metresBetween(point, me) >= REPORT_EVERY_M;
    const due = now - at >= REPORT_EVERY_MS;

    // Either enough time or enough distance — a car in traffic still
    // reports, and a car on a motorway does not report every metre.
    if (!moved && !due) return;

    lastReportRef.current = { at: now, point: me };

    api.rides
      .reportLocation(rideId, { lat: me.lat, lng: me.lng, heading })
      .catch(() => {
        // A dropped fix is not worth interrupting the drive for; the next
        // one is a few seconds away.
      });
  }, [isDriver, me, heading, rideId, finished]);

  // --- the rider reads it back ------------------------------------------

  useEffect(() => {
    if (isDriver || finished) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const live = await api.rides.live(rideId);

        if (cancelled) return;

        setDriverLive(live.driver);
        setTripStatus(live.tripStatus);
      } catch {
        // Keep the last known position rather than blanking the map.
      }
    };

    poll();

    const timer = setInterval(poll, POLL_LIVE_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isDriver, rideId, finished]);

  // The driver's own view of the trip status can change from elsewhere
  // too (a second tab, a reload), so keep it fresh either way.
  useEffect(() => {
    if (!isDriver || finished) return;

    const timer = setInterval(async () => {
      try {
        const live = await api.rides.live(rideId);
        setTripStatus(live.tripStatus);
      } catch {
        // Ignore.
      }
    }, POLL_LIVE_MS * 3);

    return () => clearInterval(timer);
  }, [isDriver, rideId, finished]);

  // --- the road to the pickup point -------------------------------------

  const toPickup = me && pickup ? metresBetween(me, pickup) : null;
  const atPickup = toPickup != null && toPickup <= ARRIVED_M;

  useEffect(() => {
    // Only the driver drives to the pickup, and only before they arrive.
    if (!isDriver || !me || !pickup || started || finished || atPickup) return;

    const now = Date.now();
    const { at, from } = lastRouteRef.current;

    const movedFar = !from || metresBetween(from, me) > REROUTE_AFTER_M;
    const cooled = now - at > REROUTE_EVERY_MS;

    if (!movedFar || !cooled) return;

    lastRouteRef.current = { at: now, from: me };

    let cancelled = false;
    setRoutingPickup(true);

    computeRoute(me, pickup)
      .then((route) => !cancelled && setPickupRoute(route))
      .catch(() => {
        // Falls back to no line rather than a wrong one.
      })
      .finally(() => !cancelled && setRoutingPickup(false));
  }, [isDriver, me, pickup, started, finished, atPickup]);

  // --- the map ----------------------------------------------------------

  useEffect(() => {
    if (!ride || !containerRef.current) return;

    const start =
      ride.routeGeometry?.coordinates?.[0] ||
      (ride.pickupLng != null ? [ride.pickupLng, ride.pickupLat] : null);

    if (!start) return;

    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        const HtmlMarker = createHtmlMarker(maps);
        markerClassRef.current = HtmlMarker;

        const map = new maps.Map(containerRef.current, {
          mapId: mapId(),
          center: { lat: start[1], lng: start[0] },
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });

        mapRef.current = map;

        // Panning by hand means you want to look somewhere else; stop
        // yanking the view back on the next position fix.
        map.addListener("dragstart", () => {
          followRef.current = false;
          setFollowing(false);
        });

        const bounds = new maps.LatLngBounds();

        const pin = (lat, lng, kind) => {
          bounds.extend({ lat, lng });

          new HtmlMarker({
            position: new maps.LatLng(lat, lng),
            className: `map-pin map-pin--${kind}`,
            map,
            zIndex: 5,
          });
        };

        if (ride.pickupLng != null) pin(ride.pickupLat, ride.pickupLng, "pickup");
        if (ride.dropoffLng != null) pin(ride.dropoffLat, ride.dropoffLng, "dropoff");

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 64);

          maps.event.addListenerOnce(map, "idle", () => {
            if (map.getZoom() > 16) map.setZoom(16);
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
      mapRef.current = null;
      markerClassRef.current = null;
      meMarkerRef.current = null;
      driverMarkerRef.current = null;
      pickupLineRef.current = null;
      trailLineRef.current = null;
      rideLineRef.current = null;
      rideArrowsRef.current = [];
    };
  }, [ride]);

  // --- the ride's own route, drawn once the trip is under way -----------

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    const HtmlMarker = markerClassRef.current;
    const coordinates = ride?.routeGeometry?.coordinates;

    if (!map || !maps || !HtmlMarker || !coordinates?.length) return;

    // Before the two people meet, the stored route is not the journey
    // anyone is on. Showing it then buries the leg that matters.
    const show = started || finished || !isDriver;

    if (!show) {
      rideLineRef.current?.setMap(null);
      rideLineRef.current = null;
      rideArrowsRef.current.forEach((a) => a.setMap(null));
      rideArrowsRef.current = [];
      return;
    }

    if (rideLineRef.current) return;

    const path = coordinates.map(toLatLng);

    rideLineRef.current = new maps.Polyline({
      path,
      map,
      strokeColor: "#ff8fa3",
      strokeOpacity: 1,
      strokeWeight: 5.5,
      zIndex: 2,
    });

    rideArrowsRef.current = directionArrows(coordinates).map((arrow) => {
      const point = toLatLng(arrow.at);

      return new HtmlMarker({
        position: new maps.LatLng(point.lat, point.lng),
        className: "route-arrow-wrap",
        html: `<span class="route-arrow" style="transform: rotate(${arrow.heading}deg)">➤</span>`,
        map,
        zIndex: 3,
      });
    });
  }, [ride, started, finished, isDriver]);

  // --- the driver's road to the pickup ----------------------------------

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;

    if (!map || !maps) return;

    const coordinates = pickupRoute?.geometry?.coordinates;

    if (!coordinates?.length || started || finished || atPickup) {
      pickupLineRef.current?.setMap(null);
      pickupLineRef.current = null;
      return;
    }

    const path = coordinates.map(toLatLng);

    if (pickupLineRef.current) {
      pickupLineRef.current.setPath(path);
      return;
    }

    // A different colour from the ride itself. These are two legs of one
    // trip, and confusing them is how someone drives the wrong route.
    pickupLineRef.current = new maps.Polyline({
      path,
      map,
      strokeColor: "#5b6ee1",
      strokeOpacity: 0.95,
      strokeWeight: 5,
      zIndex: 4,
    });
  }, [pickupRoute, started, finished, atPickup]);

  // --- where you have actually been -------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;

    if (!map || !maps || trail.length < 2) return;

    const path = trail.map((p) => ({ lat: p.lat, lng: p.lng }));

    if (trailLineRef.current) {
      trailLineRef.current.setPath(path);
      return;
    }

    trailLineRef.current = new maps.Polyline({
      path,
      map,
      strokeColor: "#2b2622",
      strokeOpacity: 0.35,
      strokeWeight: 3,
      zIndex: 1,
    });
  }, [trail]);

  // --- your own marker --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    const HtmlMarker = markerClassRef.current;

    if (!map || !maps || !HtmlMarker || !me) return;

    const position = new maps.LatLng(me.lat, me.lng);

    if (!meMarkerRef.current) {
      // The driver is a vehicle on the road; the rider is a person on a
      // kerb. Showing a car for both would be a lie about who is moving.
      const glyph = isDriver ? vehicleIcon(ride?.vehicle) : "🧍";

      meMarkerRef.current = new HtmlMarker({
        position,
        className: "live-marker",
        html: `<span class="live-marker-glyph">${glyph}</span>`,
        map,
        zIndex: 20,
      });
    } else {
      meMarkerRef.current.setPosition(position);
    }

    const glyph = meMarkerRef.current.getElement().querySelector(".live-marker-glyph");

    // Only the vehicle turns to face its direction of travel; a walking
    // figure rotated on its side reads as a person falling over.
    if (glyph && isDriver) {
      glyph.style.transform = `rotate(${heading}deg)`;
    }

    if (followRef.current) map.panTo(position);
  }, [me, heading, isDriver, ride]);

  // --- the driver's marker, on the rider's map --------------------------

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    const HtmlMarker = markerClassRef.current;

    if (!map || !maps || !HtmlMarker || isDriver || !driverLive) return;

    const position = new maps.LatLng(driverLive.lat, driverLive.lng);

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new HtmlMarker({
        position,
        className: "live-marker live-marker--driver",
        html: `<span class="live-marker-glyph">${vehicleIcon(ride?.vehicle)}</span>`,
        map,
        zIndex: 25,
      });
    } else {
      driverMarkerRef.current.setPosition(position);
    }

    const el = driverMarkerRef.current.getElement();

    // A fix too old to trust is shown greyed rather than hidden: a marker
    // frozen in the wrong street with no explanation is worse than one
    // openly marked as last seen a while ago.
    el.classList.toggle("live-marker--stale", Boolean(driverLive.stale));

    const glyph = el.querySelector(".live-marker-glyph");

    if (glyph && Number.isFinite(driverLive.heading)) {
      glyph.style.transform = `rotate(${driverLive.heading}deg)`;
    }
  }, [driverLive, isDriver, ride]);

  // --- actions ----------------------------------------------------------

  const setTrip = useCallback(
    async (status) => {
      setBusyStatus(true);
      setActionError("");

      try {
        const { tripStatus: next } = await api.rides.setTrip(rideId, status);
        setTripStatus(next);
      } catch (err) {
        setActionError(err.message);
      } finally {
        setBusyStatus(false);
      }
    },
    [rideId]
  );

  const cancel = async () => {
    if (!requestId) return;

    setCancelling(true);
    setActionError("");

    try {
      await api.requests.cancel(requestId);
      onCancelled?.();
    } catch (err) {
      setActionError(err.message);
      setCancelling(false);
    }
  };

  const recentre = () => {
    followRef.current = true;
    setFollowing(true);

    const focus = isDriver ? me : driverLive || me;

    if (mapRef.current && focus) {
      mapRef.current.panTo({ lat: focus.lat, lng: focus.lng });
      mapRef.current.setZoom(16);
    }
  };

  // Real turn-by-turn, handed to the maps app the phone already has.
  // Building it in-app would mean paying for directions on every reroute.
  const navTarget = started && ride?.dropoffLat != null
    ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
    : pickup;

  const directionsLink = navTarget
    ? `https://www.google.com/maps/dir/?api=1&destination=${navTarget.lat},${navTarget.lng}` +
      `&travelmode=${isDriver ? "driving" : "walking"}`
    : null;

  // How far the rider is from the car they are waiting for.
  const driverAway =
    !isDriver && driverLive && pickup ? metresBetween(driverLive, pickup) : null;

  // --- what the banner says ---------------------------------------------

  const phase = (() => {
    if (finished) {
      return { step: "✓", tone: "met", title: "Trip complete", detail: ride?.dropoff };
    }

    if (started) {
      return {
        step: "2",
        tone: "moving",
        title: isDriver ? "On the way to the dropoff" : "You're on your way",
        detail: ride?.dropoff,
      };
    }

    if (tripStatus === "arrived") {
      return {
        step: "✓",
        tone: "met",
        title: isDriver ? "You're at the pickup point" : "Your ride has arrived",
        detail: isDriver
          ? `Waiting for ${contact?.name || "your rider"}`
          : `${contact?.name || "Your driver"} is at ${ride?.pickup}`,
      };
    }

    if (isDriver) {
      return {
        step: "1",
        tone: atPickup ? "met" : "",
        title: atPickup ? "You've reached the pickup point" : "Go to the pickup point first",
        detail:
          ride?.pickup +
          (toPickup != null && !atPickup
            ? ` · ${formatDistance(Math.round(toPickup))} away`
            : "") +
          (routingPickup ? " · finding the road…" : ""),
      };
    }

    return {
      step: "1",
      tone: "",
      title: `${contact?.name || "Your driver"} is on the way`,
      detail: driverAway != null
        ? `${formatDistance(Math.round(driverAway))} from the pickup point`
        : driverLive
          ? "Following their position…"
          : "Waiting for them to set off…",
    };
  })();

  if (loadError) {
    return (
      <main className="page-shell">
        <button className="secondary-button" onClick={onBack}>
          ← Back
        </button>
        <p className="form-error">{loadError}</p>
      </main>
    );
  }

  if (!ride) {
    return (
      <main className="page-shell">
        <p className="route-status">Opening the ride…</p>
      </main>
    );
  }

  return (
    <main className="page-shell live-ride">
      <div className="live-ride-head">
        <button className="secondary-button" onClick={onBack}>
          ← Back
        </button>

        <span className="eyebrow">{isDriver ? "YOU ARE DRIVING" : "YOUR RIDE"}</span>
      </div>

      <section className={`live-phase ${phase.tone ? `live-phase--${phase.tone}` : ""}`}>
        <div className="live-phase-step">{phase.step}</div>

        <div className="live-phase-copy">
          <strong>{phase.title}</strong>
          <span>{phase.detail}</span>
        </div>

        {directionsLink && !finished && (
          <a className="secondary-button" href={directionsLink} target="_blank" rel="noreferrer">
            Directions ↗
          </a>
        )}
      </section>

      {/* The driver drives the trip forward. Arrival is confirmed rather
          than inferred: GPS says "near the kerb" a good minute before a
          car has actually stopped at it. */}
      {isDriver && !finished && (
        <section className="live-steps">
          <button
            className="primary-button"
            disabled={busyStatus || tripStatus === "arrived" || started}
            onClick={() => setTrip("arrived")}
          >
            {tripStatus === "arrived" || started ? "Arrival sent ✓" : "I've arrived"}
          </button>

          <button
            className="primary-button"
            disabled={busyStatus || started || tripStatus !== "arrived"}
            onClick={() => setTrip("started")}
          >
            {started ? "Ride started ✓" : "Start ride"}
          </button>

          <button
            className="secondary-button"
            disabled={busyStatus || !started}
            onClick={() => setTrip("completed")}
          >
            Finish trip
          </button>
        </section>
      )}

      <section className="live-ride-card">
        <div className="live-vehicle">
          <span className="live-vehicle-icon">{vehicleIcon(ride.vehicle)}</span>

          <div>
            <strong>{isDriver ? contact?.name || withName || "Your rider" : ride.name}</strong>
            <span>
              {ride.vehicle || "Vehicle"}
              {ride.vehicleNumber ? ` · ${ride.vehicleNumber}` : ""}
            </span>
          </div>
        </div>

        <div className="live-route">
          <div>
            <small>PICKUP</small>
            <strong>{ride.pickup}</strong>
          </div>

          <div className="trip-line">─────────→</div>

          <div>
            <small>DROPOFF</small>
            <strong>{ride.dropoff}</strong>
          </div>
        </div>

        <div className="live-stats">
          <div>
            <small>ROUTE</small>
            <strong>{formatDistance(ride.distanceMeters) || "—"}</strong>
          </div>

          <div>
            <small>DRIVE</small>
            <strong>{formatDuration(ride.durationSeconds) || "—"}</strong>
          </div>

          <div>
            <small>{isDriver ? "TO PICKUP" : "DRIVER"}</small>
            <strong>
              {isDriver
                ? toPickup == null
                  ? geoError
                    ? "—"
                    : "locating…"
                  : formatDistance(Math.round(toPickup))
                : driverAway == null
                  ? "—"
                  : formatDistance(Math.round(driverAway))}
            </strong>
          </div>

          <div>
            <small>VIA ROADS</small>
            <strong>
              {pickupRoute && !started
                ? formatDuration(pickupRoute.durationSeconds)
                : formatDuration(ride.durationSeconds) || "—"}
            </strong>
          </div>
        </div>

        <div className="live-actions">
          {contact?.phone ? (
            <>
              <a className="secondary-button" href={`tel:${contact.phone}`}>
                ☎ Call {isDriver ? "rider" : "driver"}
              </a>

              <a className="secondary-button" href={`sms:${contact.phone}`}>
                ✉ Message
              </a>
            </>
          ) : (
            <span className="address-hint">
              {contact ? "No phone number on their profile yet." : "Loading contact details…"}
            </span>
          )}

          {requestId && !finished && (
            <button
              type="button"
              className="danger-button"
              onClick={cancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel ride"}
            </button>
          )}
        </div>

        {actionError && <p className="form-error">{actionError}</p>}

        {geoError && <p className="address-hint">{geoError}</p>}

        {!isDriver && driverLive?.stale && (
          <p className="address-hint">
            Their last position is a little old — their phone may have gone to
            sleep.
          </p>
        )}
      </section>

      <div className="live-map-wrap">
        <div className="live-map" ref={containerRef} />

        {!following && (
          <button type="button" className="recentre-button" onClick={recentre}>
            ◎ Recentre
          </button>
        )}

        <div className="live-legend">
          {!started && isDriver && <span className="legend-pickup">route to pickup</span>}
          <span className="legend-ride">the ride</span>
          {trail.length > 1 && <span className="legend-trail">where you've been</span>}
        </div>
      </div>
    </main>
  );
}
