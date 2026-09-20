import React, { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps, createHtmlMarker, mapId } from "./lib/maps";
import { api } from "./lib/api";
import { computeRoute, formatDistance, formatDuration } from "./lib/geo";
import { formatFare } from "./lib/fare";
import { vehicleIconSvg, personIconSvg, routeArrowSvg } from "./lib/vehicleIcons";
import VehicleIcon from "./VehicleIcon";
import TripChat from "./TripChat";
import ReportTrip from "./ReportTrip";

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

// Re-routing costs an OpenRouteService call, so it happens when the road
// actually changed — not on every position fix.
//
// The two sides are watching the same leg for different reasons, and they
// do not need it at the same rate. The driver is navigating: their line
// has to keep up with the turn they are about to take. The rider is
// watching a marker that already moves in real time, and only needs the
// road under it redrawn when the car has genuinely gone another way. A
// lazier cadence there is most of the routing bill for this screen.
const REROUTE = {
  driver: { afterM: 150, everyMs: 20000 },
  rider: { afterM: 400, everyMs: 45000 },
};

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
 * Both sides watch whichever leg is running, drawn as a live road rather
 * than a straight line: the driver routes from their own position, the
 * rider from the driver's last reported one. So a rider at a kerb sees the
 * street the car is actually coming down and how long it has left, and
 * once the ride starts, the same pair of numbers counts down to the
 * dropoff instead.
 *
 * The driver's position is written to the server as they move and read
 * back by the riders they accepted. Nobody else can read it.
 *
 * The driver moves the trip between legs by hand — arrived, then started,
 * then finished. GPS calls a car "at the kerb" a good minute before it has
 * stopped at one, and only the driver knows whether anyone got in.
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
  const legLineRef = useRef(null);
  const trailLineRef = useRef(null);
  const rideLineRef = useRef(null);
  const rideArrowsRef = useRef([]);

  const followRef = useRef(true);
  const lastFixRef = useRef(null);
  const lastReportRef = useRef({ at: 0, point: null });
  const lastRouteRef = useRef({ at: 0, from: null, leg: null });

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
  const [legRoute, setLegRoute] = useState(null);
  const [routingLeg, setRoutingLeg] = useState(false);

  // The map is built asynchronously into a ref, which no render ever sees.
  // Without this the effects that draw on it can run once, before it
  // exists, and never again — lines that are simply never there.
  const [mapReady, setMapReady] = useState(false);

  // Messaging and reporting both hang off the request rather than the
  // ride: they concern the two people on this one trip.
  const [showChat, setShowChat] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [unread, setUnread] = useState(0);

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

  const dropoff =
    ride?.dropoffLat != null ? { lat: ride.dropoffLat, lng: ride.dropoffLng } : null;

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

  // --- messages waiting -------------------------------------------------

  useEffect(() => {
    if (!requestId || showChat) return;

    let cancelled = false;

    const check = () =>
      api.messages
        .unread()
        .then((data) => !cancelled && setUnread(data.unread?.[requestId] || 0))
        .catch(() => {
          // A badge is not worth surfacing an error for.
        });

    check();

    const timer = setInterval(check, POLL_LIVE_MS * 2);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [requestId, showChat]);

  // --- the leg being driven right now -----------------------------------
  //
  // A trip is two journeys and only one of them is running at a time.
  // Until the ride starts, the road that matters runs from the vehicle to
  // the pickup point; after it, from the vehicle to the dropoff. Both
  // sides watch the same leg — the driver from their own position, the
  // rider from the driver's last reported one — so a rider at a kerb sees
  // the actual road the car is coming down, not just a dot drifting.

  const leg = started ? "dropoff" : "pickup";
  const legTarget = started ? dropoff : pickup;
  const vehicleAt = isDriver ? me : driverLive;

  const toTarget =
    vehicleAt && legTarget ? metresBetween(vehicleAt, legTarget) : null;

  const atTarget = toTarget != null && toTarget <= ARRIVED_M;

  // The meeting specifically, as opposed to arriving anywhere.
  const atPickup = !started && atTarget;

  useEffect(() => {
    if (!vehicleAt || !legTarget || finished) return;

    // Once the car is at the kerb the route is a few metres of squiggle.
    // The driver is looking for a person by then, not for a road.
    if (!started && atTarget) return;

    const now = Date.now();
    const { at, from, leg: lastLeg } = lastRouteRef.current;

    const pace = isDriver ? REROUTE.driver : REROUTE.rider;

    // A new leg is worth a route however recently the last one ran —
    // otherwise the road to the pickup stays on screen after the ride has
    // started, pointing backwards.
    const switched = leg !== lastLeg;
    const movedFar = !from || metresBetween(from, vehicleAt) > pace.afterM;
    const cooled = now - at > pace.everyMs;

    if (!switched && (!movedFar || !cooled)) return;

    lastRouteRef.current = { at: now, from: vehicleAt, leg };

    setRoutingLeg(true);

    // Deliberately not cancelled when this effect re-runs. A position fix
    // arrives every few seconds, so discarding the request in flight each
    // time would mean the road ahead never finished drawing at all — and
    // the throttle above has already spent the call.
    computeRoute(vehicleAt, legTarget)
      .then((route) => setLegRoute({ ...route, leg }))
      .catch(() => {
        // Falls back to no line rather than a wrong one.
      })
      .finally(() => setRoutingLeg(false));
  }, [isDriver, vehicleAt, legTarget, leg, started, finished, atTarget]);

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
        setMapReady(true);

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
      setMapReady(false);
      mapRef.current = null;
      markerClassRef.current = null;
      meMarkerRef.current = null;
      driverMarkerRef.current = null;
      legLineRef.current = null;
      trailLineRef.current = null;
      rideLineRef.current = null;
      rideArrowsRef.current = [];
    };
  }, [ride]);

  // --- the ride's own route ---------------------------------------------
  //
  // Drawn from the start, so both sides can see where the trip is
  // eventually going — but held back to a faint line until the ride
  // actually begins. Before the meeting, the leg that matters is the one
  // reaching the pickup point, and a bold route straight through it is
  // exactly what buries that.

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    const HtmlMarker = markerClassRef.current;
    const coordinates = ride?.routeGeometry?.coordinates;

    if (!map || !maps || !HtmlMarker || !coordinates?.length) return;

    const path = coordinates.map(toLatLng);

    if (!rideLineRef.current) {
      rideLineRef.current = new maps.Polyline({
        path,
        map,
        strokeColor: "#ff8fa3",
        zIndex: 2,
      });
    }

    const underWay = started || finished;

    rideLineRef.current.setOptions({
      strokeOpacity: underWay ? 1 : 0.4,
      strokeWeight: underWay ? 5.5 : 4,
    });

    // Arrows are for the route being driven. On a faint background line
    // they read as clutter over the leg that is actually live.
    if (!underWay) {
      rideArrowsRef.current.forEach((a) => a.setMap(null));
      rideArrowsRef.current = [];
      return;
    }

    if (rideArrowsRef.current.length) return;

    rideArrowsRef.current = directionArrows(coordinates).map((arrow) => {
      const point = toLatLng(arrow.at);

      return new HtmlMarker({
        position: new maps.LatLng(point.lat, point.lng),
        className: "route-arrow-wrap",
        html:
          `<span class="route-arrow" style="transform: rotate(${arrow.heading}deg)">` +
          `${routeArrowSvg()}</span>`,
        map,
        zIndex: 3,
      });
    });
  }, [ride, started, finished, mapReady]);

  // --- the road the vehicle is on right now ------------------------------

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;

    if (!map || !maps) return;

    // A route computed for the other leg is worse than none: it points at
    // the place this trip has already left.
    const coordinates =
      legRoute?.leg === leg ? legRoute?.geometry?.coordinates : null;

    if (!coordinates?.length || finished || atPickup) {
      legLineRef.current?.setMap(null);
      legLineRef.current = null;
      return;
    }

    const path = coordinates.map(toLatLng);

    if (legLineRef.current) {
      legLineRef.current.setPath(path);
      return;
    }

    // A different colour from the stored route. This one is live and only
    // ever the road ahead of the vehicle; confusing the two is how someone
    // drives the wrong leg.
    legLineRef.current = new maps.Polyline({
      path,
      map,
      strokeColor: "#5b6ee1",
      strokeOpacity: 0.95,
      strokeWeight: 5,
      zIndex: 4,
    });
  }, [legRoute, leg, finished, atPickup, mapReady]);

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
      const glyph = isDriver ? vehicleIconSvg(ride?.vehicle) : personIconSvg();

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
        html: `<span class="live-marker-glyph">${vehicleIconSvg(ride?.vehicle)}</span>`,
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
  const directionsLink = legTarget
    ? `https://www.google.com/maps/dir/?api=1&destination=${legTarget.lat},${legTarget.lng}` +
      `&travelmode=${isDriver ? "driving" : "walking"}`
    : null;

  // How far the vehicle still has to go on this leg, and how long that
  // takes by road. Both sides see the same two numbers about the same car.
  const away = toTarget != null ? formatDistance(Math.round(toTarget)) : null;

  const eta =
    legRoute?.leg === leg && !finished
      ? formatDuration(legRoute.durationSeconds)
      : null;

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
        detail:
          ride?.dropoff +
          (away ? ` · ${away} to go` : "") +
          (eta ? ` · about ${eta}` : ""),
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
          (away && !atPickup ? ` · ${away} away` : "") +
          (eta && !atPickup ? ` · about ${eta}` : "") +
          (routingLeg ? " · finding the road…" : ""),
      };
    }

    return {
      step: "1",
      tone: "",
      title: `${contact?.name || "Your driver"} is coming to you`,
      detail: away
        ? `${away} from ${ride?.pickup}` + (eta ? ` · about ${eta}` : "")
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
      <header className="live-ride-head">
        <button className="live-back" onClick={onBack}>
          ← Back
        </button>

        <span className="eyebrow">{isDriver ? "YOU ARE DRIVING" : "YOUR RIDE"}</span>
      </header>

      {/* The map is the screen. Everything else reads as a sheet over it —
          on a narrow screen literally so, sliding up from the bottom the
          way every tracking screen does it. */}
      <div className="live-layout">
        <div className="live-map-wrap">
          <div className="live-map" ref={containerRef} />

          {!following && (
            <button type="button" className="recentre-button" onClick={recentre}>
              ◎ Recentre
            </button>
          )}

          <div className="live-legend">
            {!finished && (
              <span className="legend-pickup">
                {started ? "road ahead" : "route to pickup"}
              </span>
            )}
            <span className="legend-ride">the ride</span>
            {trail.length > 1 && <span className="legend-trail">where you've been</span>}
          </div>
        </div>

        <section className="live-sheet">
          <div className={`live-phase ${phase.tone ? `live-phase--${phase.tone}` : ""}`}>
            <div className="live-phase-step">{phase.step}</div>

            <div className="live-phase-copy">
              <strong>{phase.title}</strong>
              <span>{phase.detail}</span>
            </div>
          </div>

          {/* One primary action per state, and it is the thing the trip is
              waiting on. Directions sit beside it as the alternative, not
              as an equal. */}
          {!finished && (
            <div className="live-do">
              {isDriver && tripStatus !== "arrived" && !started && (
                <button
                  className="primary-button live-do-main"
                  disabled={busyStatus}
                  onClick={() => setTrip("arrived")}
                >
                  {atPickup ? "I'm here — tell them" : "I've arrived"}
                </button>
              )}

              {isDriver && tripStatus === "arrived" && !started && (
                <button
                  className="primary-button live-do-main"
                  disabled={busyStatus}
                  onClick={() => setTrip("started")}
                >
                  Start ride →
                </button>
              )}

              {isDriver && started && (
                <button
                  className="primary-button live-do-main"
                  disabled={busyStatus}
                  onClick={() => setTrip("completed")}
                >
                  {atTarget ? "Finish trip — you're there" : "Finish trip"}
                </button>
              )}

              {directionsLink && (
                <a
                  className="live-do-alt"
                  href={directionsLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Directions ↗
                </a>
              )}
            </div>
          )}

          {/* Said in words, next to the button that acts on it. */}
          {isDriver && tripStatus === "arrived" && !started && (
            <p className="live-ask">
              {contact?.name || "Your rider"} knows you're here. Once they're in,
              start the ride — that's what puts the road to {ride?.dropoff} on
              both your screens.
            </p>
          )}

          {isDriver && started && atTarget && (
            <p className="live-ask">
              You've reached {ride?.dropoff}. Finish the trip to close it off.
            </p>
          )}

          <div className="live-person">
            <span className="live-person-icon">
              <VehicleIcon vehicle={isDriver ? "none" : ride.vehicle} size={26} />
            </span>

            <div className="live-person-who">
              <strong>
                {isDriver ? contact?.name || withName || "Your rider" : ride.name}
              </strong>
              <span>
                {isDriver
                  ? "Your rider"
                  : `${ride.vehicle || "Vehicle"}${
                      ride.vehicleNumber ? ` · ${ride.vehicleNumber}` : ""
                    }`}
              </span>
            </div>

            <div className="live-person-reach">
              {requestId && (
                <button
                  type="button"
                  className="icon-button icon-button--badge"
                  onClick={() => {
                    setShowChat((open) => !open);
                    setUnread(0);
                  }}
                  aria-label={
                    unread ? `Messages, ${unread} unread` : "Messages on this trip"
                  }
                  title="Messages"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="M4 5.5h16v10.5H9.5L5.5 19v-3H4Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinejoin="round"
                    />
                  </svg>

                  {unread > 0 && <span className="icon-badge">{unread}</span>}
                </button>
              )}
            </div>

            {contact?.phone && (
              <div className="live-person-reach">
                <a
                  className="icon-button"
                  href={`tel:${contact.phone}`}
                  aria-label={`Call ${isDriver ? "rider" : "driver"}`}
                  title={`Call ${isDriver ? "rider" : "driver"}`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="M6.6 3.5h3l1.5 3.8-2 1.5a12 12 0 0 0 6.1 6.1l1.5-2 3.8 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>

                <a
                  className="icon-button"
                  href={`sms:${contact.phone}`}
                  aria-label="Send a text message"
                  title="Text message"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <rect
                      x="3" y="5" width="18" height="14" rx="2.5"
                      fill="none" stroke="currentColor" strokeWidth="1.9"
                    />
                    <path
                      d="m3.8 6.5 8.2 6.2 8.2-6.2"
                      fill="none" stroke="currentColor" strokeWidth="1.9"
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                </a>
              </div>
            )}
          </div>

          {/* The plate is what someone actually looks for at a kerb, so on
              the rider's screen it is a line of its own rather than a
              detail appended to the vehicle name. */}
          {!isDriver && ride.vehicleNumber && (
            <p className="live-plate">
              <small>LOOK FOR</small>
              <strong>{ride.vehicleNumber}</strong>
            </p>
          )}

          {!contact?.phone && (
            <p className="address-hint">
              {contact
                ? "No phone number on their profile yet."
                : "Loading contact details…"}
            </p>
          )}

          {/* Two stops on one line, in the order they happen. The marker
              for the leg under way is filled; the one already behind is
              not — the same reading as the map. */}
          <ol className="live-stops">
            <li className={started || finished ? "is-done" : "is-now"}>
              <small>PICKUP</small>
              <strong>{ride.pickup}</strong>
            </li>

            <li className={started ? "is-now" : ""}>
              <small>DROPOFF</small>
              <strong>{ride.dropoff}</strong>
            </li>
          </ol>

          <div className="live-stats">
            <div>
              <small>{ride.fare ? "FARE" : "ROUTE"}</small>
              <strong>
                {formatFare(ride.fare) || formatDistance(ride.distanceMeters) || "—"}
              </strong>
            </div>

            <div>
              <small>DRIVE</small>
              <strong>{formatDuration(ride.durationSeconds) || "—"}</strong>
            </div>

            <div>
              <small>{started ? "TO DROPOFF" : "TO PICKUP"}</small>
              <strong>{away || (isDriver && !me && !geoError ? "locating…" : "—")}</strong>
            </div>

            <div>
              {/* The ride's stored duration is what the trip was always
                  going to take. Once there is a live route for the leg in
                  hand, the useful number is how long is left of it. */}
              <small>{eta ? (started ? "ARRIVING IN" : "PICKUP IN") : "VIA ROADS"}</small>
              <strong>{eta || formatDuration(ride.durationSeconds) || "—"}</strong>
            </div>
          </div>

          {actionError && <p className="form-error">{actionError}</p>}

          {geoError && <p className="address-hint">{geoError}</p>}

          {!isDriver && driverLive?.stale && (
            <p className="address-hint">
              Their last position is a little old — their phone may have gone to
              sleep.
            </p>
          )}

          {showChat && requestId && (
            <TripChat
              tripId={requestId}
              withName={contact?.name || withName}
              onUnreadChange={setUnread}
            />
          )}

          {/* Last, and quiet. Calling off a ride someone is driving to is
              not a thing to put next to the buttons you use every trip.
              Reporting sits beside it for the same reason — both are
              things you hope never to need. */}
          {requestId && (
            <div className="live-quiet">
              {!finished && (
                <button
                  type="button"
                  className="live-cancel"
                  onClick={cancel}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling…" : "Cancel ride"}
                </button>
              )}

              <button
                type="button"
                className="live-cancel"
                onClick={() => setReporting(true)}
              >
                Report a problem
              </button>
            </div>
          )}

          {reporting && requestId && (
            <ReportTrip
              tripId={requestId}
              role={role}
              withName={contact?.name || withName}
              onClose={() => setReporting(false)}
            />
          )}
        </section>
      </div>
    </main>
  );
}
