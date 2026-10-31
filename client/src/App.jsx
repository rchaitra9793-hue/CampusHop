import React, { useState, useEffect, useCallback, useRef } from "react";
import LandingPage from "./LandingPage";
import LoginPage from "./LoginPage";
import RegisterPage from "./RegisterPage";
import ForgotPassword from "./ForgotPassword";
import ResetPassword from "./ResetPassword";
import VerifyEmail from "./VerifyEmail";
import campushopLogo from "./assets/campushop-logo.png";
import { supabase } from "./supabaseClient";
import { api } from "./lib/api";

import FindRide from "./FindRide";
import OfferRide from "./OfferRide";
import MyTrips from "./MyTrips";
import RideDetails from "./RideDetails";
import ProfileSetup from "./ProfileSetup";
import IncomingRequests from "./IncomingRequests";
import RequestAlerts from "./RequestAlerts";
import VehiclePrompt from "./VehiclePrompt";
import LiveRide from "./LiveRide";
import NearbyRides from "./NearbyRides";
import RequestWaiting from "./RequestWaiting";
import SettingsPage from "./SettingsPage";
import RideOutcome from "./RideOutcome";
import CommunityPage from "./CommunityPage";
import HomePage from "./HomePage";
import { bigNumber } from "./CampusStats";
// Two administration screens. AdminDashboard is the operations view
// that arrived as its own project, unchanged; AdminConsole is the one
// built here. Each has its own gate, and an account can hold either,
// both, or neither.
import AdminDashboard from "./AdminDashboard";
import AdminConsole from "./AdminConsole";
import { useIncomingRequests } from "./lib/useIncomingRequests";
import { upcoming } from "./lib/rideState";
import { needsDetails } from "./lib/vehicles";
import {
  cancelKey,
  completeKey,
  markNoticeSeen,
  noticeSeen,
} from "./lib/rideNotices";

// Cycled so a board of rides keeps the pinned-note look.
const ACCENTS = ["coral", "sage", "lavender"];
const ROTATIONS = ["-0.8deg", "0.6deg", "-0.4deg"];

// The tabs worth returning to. `rideDetails` is deliberately absent: it
// needs a trip picked in memory, so restoring it would land on an empty
// page. It falls back to the list it was opened from.
// A ride posted in another session is an event this browser is never
// told about, so the board is re-read on a timer — the same way incoming
// requests and live trips already are.
const BOARD_POLL_MS = 8000;

const TABS = ["home", "find", "offer", "campus", "trips", "requests", "profile", "admin", "ops"];

// Everything an administrator can open. Anything else is a commuter's
// screen, and a remembered tab from before the privilege was granted
// would land them on one that has no nav entry to get back from.
//
// "ops" is the operations dashboard (ADMIN_EMAILS); "admin" is the
// console in this repo (profiles.is_admin).
const ADMIN_TABS = ["ops", "admin", "profile"];
const TAB_KEY = "campushop.tab";

// The live view needs a ride id to mean anything, so it is remembered as
// a pair. A trip in progress is exactly the thing a reload must not lose.
const LIVE_KEY = "campushop.liveRide";

function rememberedLive() {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    return parsed?.rideId ? parsed : null;
  } catch {
    return null;
  }
}


function Logo() {
  return (
    <img
      src={campushopLogo}
      alt="CampusHop"
      className="campushop-logo"
    />
  );
}

function CampusConstellation({ rides = [], onBrowse }) {
  const routeNames = rides.slice(0, 4).map((ride) => ({
    id: ride.id,
    from: ride.pickup || "Campus",
    to: ride.dropoff || "Somewhere useful",
  }));

  return (
    <section className="campus-constellation" aria-label="Campus networking idea">
      <div className="constellation-copy">
        <span className="eyebrow">THE CAMPUS WEB</span>
        <h2>One route can open a whole new circle.</h2>
        <p>
          CampusHop is not just about getting from A → B. Your next ride could
          put you beside someone from another course, another year, or a
          completely different corner of campus.
        </p>
        <div className="constellation-note">
          <span className="constellation-star">✦</span>
          <span>Plot twist: your next group-project teammate might be a ride away.</span>
        </div>
      </div>

      <div className="constellation-board">
        <div className="orbit orbit--one" />
        <div className="orbit orbit--two" />
        <div className="constellation-center">
          <span>HOP</span>
          <small>together</small>
        </div>

        <span className="constellation-node node--a">CSE</span>
        <span className="constellation-node node--b">AIML</span>
        <span className="constellation-node node--c">ECE</span>
        <span className="constellation-node node--d">MBA</span>
        <span className="constellation-node node--e">YOU</span>

        <div className="constellation-route route--a" />
        <div className="constellation-route route--b" />
        <div className="constellation-route route--c" />
        <div className="constellation-route route--d" />
      </div>

      <div className="constellation-routes">
        <div className="constellation-routes-head">
          <span>LIVE BOARD ENERGY</span>
          <strong>{rides.length} routes floating around campus</strong>
        </div>
        <div className="route-marquee">
          {routeNames.length > 0 ? (
            routeNames.map((route) => (
              <span key={route.id}>
                {route.from} <b>→</b> {route.to}
              </span>
            ))
          ) : (
            <span>Be the first one to put a route on the board ✦</span>
          )}
        </div>
        <button type="button" className="mini-browse-button" onClick={onBrowse}>
          Explore the board <span>↗</span>
        </button>
      </div>
    </section>
  );
}

function Dashboard({ user, onLogout, onUserChange, onAccountDeleted }) {
  // An administrator is campus staff here, not a commuter: they are not
  // looking for a lift, not offering one, and have no trips or requests
  // of their own. Showing them four tabs they will never open is four
  // things in the way of the queue they came for, so the shell below is
  // the admin screen and their own profile, and nothing else.
  // Either privilege puts somebody in the administration shell rather
  // than the commuter one. They are independent: one comes from
  // profiles.is_admin, the other from ADMIN_EMAILS on the server, and
  // neither implies the other.
  const hasConsole = user?.isAdmin === true;
  const hasOps = user?.isPortalAdmin === true;
  const admin = hasConsole || hasOps;

  // Signing in or reloading always lands on the home page. The one
  // exception is a trip still in progress, which is restored below only
  // after the server confirms it is active — a completed ride never
  // comes back on startup.
  const [live, setLive] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    if (admin) return hasOps ? "ops" : "admin";
    return "home";
  });

  useEffect(() => {
    try {
      // Only the real tabs are worth remembering; see TABS above.
      if (TABS.includes(activeTab)) localStorage.setItem(TAB_KEY, activeTab);
    } catch {
      // Storage unavailable — the tab simply will not survive a reload.
    }
  }, [activeTab]);

  // Two ways to end up on a tab that is not yours, both of them from a
  // remembered tab outliving the privilege that went with it: an account
  // that has had admin removed coming back to "admin", and one that has
  // just been granted it coming back to "find". Neither renders.
  useEffect(() => {
    if (admin) {
      const home = hasOps ? "ops" : "admin";

      // A tab they do not have the privilege for renders nothing, which
      // is how a remembered tab outlives the privilege it belonged to.
      if (!ADMIN_TABS.includes(activeTab)) return setActiveTab(home);
      if (activeTab === "ops" && !hasOps) return setActiveTab(home);
      if (activeTab === "admin" && !hasConsole) return setActiveTab(home);

      return undefined;
    }

    if (activeTab === "admin" || activeTab === "ops") setActiveTab("home");
    if (activeTab === "settings") setActiveTab("profile");

    return undefined;
  }, [activeTab, admin, hasOps, hasConsole]);

  useEffect(() => {
    try {
      if (live) localStorage.setItem(LIVE_KEY, JSON.stringify(live));
      else localStorage.removeItem(LIVE_KEY);
    } catch {
      // As above.
    }
  }, [live]);

  // A remembered live ride is useful across a browser restart only while
  // the trip is genuinely active. Completed/cancelled trips are cleared so
  // a restart shows the current Home/last page instead of yesterday's map.
  useEffect(() => {
    if (admin || live) return undefined;
    const remembered = rememberedLive();
    if (!remembered?.rideId) return undefined;

    let cancelled = false;
    Promise.all([
      api.rides.get(remembered.rideId),
      remembered.requestId ? api.requests.status(remembered.requestId) : null,
    ])
      .then(([ride, request]) => {
        if (cancelled) return;
        const status = ride?.tripStatus || ride?.trip_status;
        // A cancelled seat is as over as a completed trip.
        const requestOver = request && request.status !== "accepted";
        if (["completed", "cancelled", "canceled"].includes(status) || requestOver) {
          try { localStorage.removeItem(LIVE_KEY); } catch {}
          return;
        }
        if (remembered.requestId) {
          setLive(remembered);
          setActiveTab("live");
        }
      })
      .catch(() => {
        // If the old live trip can no longer be read, don't resurrect it.
        try { localStorage.removeItem(LIVE_KEY); } catch {}
      });

    return () => { cancelled = true; };
  }, [admin, live]);

  /** Open the live map for a ride — from an accept, or from My Trips. */
  const openLive = (rideId, role, withName, requestId) => {
    setLive({ rideId, role, withName, requestId });
    setActiveTab("live");
  };

  const closeLive = () => {
    // Back to wherever the trip was opened from.
    setActiveTab(live?.role === "driver" ? "requests" : "trips");
    setLive(null);
  };

  const forgetLiveRide = useCallback(() => {
    try {
      localStorage.removeItem(LIVE_KEY);
    } catch {
      // Storage unavailable — nothing was remembered either.
    }
  }, []);

  // A trip that has ended — completed or cancelled — goes back to home.
  const leaveLiveForHome = () => {
    setLive(null);
    setActiveTab("home");
  };

  // Requests are polled once here, for the whole dashboard, so a driver
  // hears about one wherever they happen to be. An administrator has no
  // rides of their own, so there is nothing to poll for and no reason to
  // ask every few seconds.
  const incoming = useIncomingRequests(admin ? null : user?.id);

  // Accounts created before signup asked for a phone number or a vehicle
  // are missing those details. Skipping is remembered for the session
  // only, so it asks again next time rather than nagging now.
  const [vehiclePromptSkipped, setVehiclePromptSkipped] = useState(() => {
    try {
      return sessionStorage.getItem("campushop.vehiclePromptSkipped") === "1";
    } catch {
      return false;
    }
  });

  // And no reason to ask an administrator what they drive.
  const askForVehicle = !admin && needsDetails(user) && !vehiclePromptSkipped;

  const skipVehiclePrompt = () => {
    try {
      sessionStorage.setItem("campushop.vehiclePromptSkipped", "1");
    } catch {
      // Storage unavailable — it will simply ask again on the next render
      // of a fresh session.
    }

    setVehiclePromptSkipped(true);
  };

  const [rides, setRides] = useState([]);

  // Campus-wide totals for the badge: km travelled together, rides done.
  const [campus, setCampus] = useState(null);

  useEffect(() => {
    if (admin) return undefined;

    let cancelled = false;
    const loadCampus = () =>
      api.community
        .stats()
        .then((s) => !cancelled && setCampus(s))
        .catch(() => {
          // The badge simply shows fewer numbers.
        });

    loadCampus();
    const timer = setInterval(loadCampus, 60000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [admin]);

  // Seeds the Find-a-ride search when someone starts from the dashboard.
  const [search, setSearch] = useState({ from: null, to: null, arriveBy: "08:30" });

  const [selectedTrip, setSelectedTrip] = useState(null);
  const [ridesError, setRidesError] = useState("");

  // The ride whose request is currently in flight. Holding it here is what
  // stops a second click from opening a second request while the first is
  // still on the wire — the server would refuse it, but the rider should
  // never see that error for something they only meant to do once.
  const [pendingRideId, setPendingRideId] = useState(null);

  // The request the rider is currently watching for an answer to.
  const [waitingOn, setWaitingOn] = useState(null);

  // The board shown on the dashboard. Ranking happens in the API; here we
  // just ask for everything and paint it.
  const boardSignature = useRef(null);

  const loadRides = useCallback(async () => {
    try {
      const { rides: board } = await api.rides.list();

      // The API already ends the board at each ride's departure, so this
      // takes out only what expired since the response was written — and,
      // more to the point, what expires while this tab sits open between
      // polls. Filtered here rather than on each screen so every one of
      // them is working from the same list: the dashboard board, the
      // nearby strip and the Find page all read this.
      const rows = upcoming(board);

      // Publishing a new array on every tick would restart the Find page's
      // own fetch each time, so the board is only replaced when something
      // actually moved. Route geometry is left out — it never changes for
      // a ride that already exists.
      const signature = JSON.stringify(
        rows.map((r) => [
          r.id,
          r.seatsLeft,
          r.tripStatus,
          r.myRequestStatus,
          r.time,
          r.date,
        ])
      );

      if (signature !== boardSignature.current) {
        boardSignature.current = signature;

        setRides(
          rows.map((ride, i) => ({
            ...ride,
            accent: ACCENTS[i % ACCENTS.length],
            rotation: ROTATIONS[i % ROTATIONS.length],
          }))
        );
      }

      setRidesError("");
    } catch (err) {
      setRidesError(err.message);
    }
  }, []);

  useEffect(() => {
    loadRides();

    const timer = setInterval(loadRides, BOARD_POLL_MS);

    // Polling a backgrounded tab is wasted; coming back to it should show
    // the current board immediately rather than after the next tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") loadRides();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadRides]);

  // Re-fetch rather than splicing a local copy, so what is on screen is
  // always what the server actually stored.
  const addRide = () => {
    loadRides();
    setActiveTab("home");
  };

  const pendingCount = incoming.requests.filter((r) => r.status === "pending").length;

  // --- "your ride was cancelled / completed", wherever you are ---------
  //
  // The live screen tells both people itself. This covers the person who
  // is on some other page when the other side cancels, or when the driver
  // finishes the trip, so nobody is left waiting for a ride that is over.
  const [rideNotice, setRideNotice] = useState(null);
  const lastTripStatus = useRef(new Map());

  const openLiveRequestId = activeTab === "live" ? live?.requestId : null;
  const waitingTripId = waitingOn?.tripId ?? null;

  const raiseNotice = useCallback((key, notice) => {
    if (noticeSeen(key)) return false;
    markNoticeSeen(key);
    setRideNotice(notice);
    return true;
  }, []);

  // Driver side: a rider cancelling shows up on the incoming list.
  useEffect(() => {
    if (admin || rideNotice) return;

    for (const r of incoming.requests) {
      if (r.status !== "cancelled_by_rider" || r.id === openLiveRequestId) continue;

      const raised = raiseNotice(cancelKey(r.id), {
        kind: "cancelled",
        message:
          `${r.riderName || "Your rider"} cancelled the ride` +
          (r.ride?.pickup ? ` from ${r.ride.pickup}` : "") +
          ".",
      });

      if (raised) return;
    }
  }, [admin, incoming.requests, rideNotice, openLiveRequestId, raiseNotice]);

  // Rider side: the driver cancelling, or finishing the trip.
  useEffect(() => {
    if (admin || rideNotice) return undefined;

    let cancelled = false;

    const check = async () => {
      try {
        const trips = await api.requests.mine();

        if (cancelled) return;

        for (const t of trips) {
          const previous = lastTripStatus.current.get(t.tripId);
          lastTripStatus.current.set(t.tripId, t.tripStatus);

          if (t.tripId === openLiveRequestId || t.tripId === waitingTripId) continue;

          if (t.status === "cancelled_by_driver") {
            const raised = raiseNotice(cancelKey(t.tripId), {
              kind: "cancelled",
              message:
                `${t.person || "Your driver"} cancelled the ride` +
                (t.pickup ? ` from ${t.pickup}` : "") +
                ".",
            });

            if (raised) return;
          }

          // Only a trip seen finishing during this visit — not every
          // completed trip in the history the first time the list loads.
          if (
            t.status === "accepted" &&
            t.tripStatus === "completed" &&
            previous &&
            previous !== "completed"
          ) {
            const raised = raiseNotice(completeKey(t.tripId), {
              kind: "completed",
              message: `${t.person || "Your driver"} marked your ride to ${t.dropoff || "your destination"} as completed.`,
            });

            if (raised) return;
          }
        }
      } catch {
        // A missed poll is not news.
      }
    };

    check();

    const timer = setInterval(check, BOARD_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [admin, rideNotice, openLiveRequestId, waitingTripId, raiseNotice]);

  const cancelAsDriver = async (request) => {
    const who = request.riderName || "Your rider";

    if (!window.confirm(`Cancel this ride? ${who} will be told it has been cancelled.`)) {
      return;
    }

    try {
      await api.requests.cancel(request.id);
      markNoticeSeen(cancelKey(request.id));
      setRideNotice({
        kind: "cancelled",
        message: `You cancelled the ride. ${who} has been told.`,
      });
    } catch (err) {
      setRidesError(err.message);
    } finally {
      loadRides();
      incoming.refresh(true);
    }
  };

  const requestRide = async (ride) => {
    if (pendingRideId) return;

    setPendingRideId(ride.id);

    try {
      const { request } = await api.requests.create(ride.id);

      // Re-read the board so every card showing this ride switches to
      // "Requested" — including the copy the Find page is rendering.
      await loadRides();

      // Hold the moment rather than dropping them into a list. The wait
      // is the part that needs acknowledging.
      setWaitingOn({
        tripId: request.id,
        rideId: ride.id,
        driverName: ride.name,
      });
    } catch (err) {
      // Surfaces the server's own rules: your own ride, already
      // requested, or the vehicle is full. Reload either way, since a
      // refusal usually means our copy of the board is out of date.
      setRidesError(err.message);
      loadRides();
    } finally {
      setPendingRideId(null);
    }
  };

  return (
    <div className="dashboard">
      {rideNotice && (
        <RideOutcome
          kind={rideNotice.kind}
          title={rideNotice.title}
          message={rideNotice.message}
          // A completed ride is only a message; a cancelled one goes home.
          redirect={rideNotice.kind !== "completed"}
          onDone={() => {
            setRideNotice(null);
            loadRides();
            incoming.refresh(true);
            if (rideNotice.kind === "completed") return;
            setLive(null);
            setActiveTab("home");
          }}
        />
      )}

      {waitingOn && (
        <RequestWaiting
          rideId={waitingOn.rideId}
          tripId={waitingOn.tripId}
          driverName={waitingOn.driverName}
          onClose={({ cancelled }) => {
            setWaitingOn(null);
            loadRides();

            // Backing out leaves them on the board to pick again; waiting
            // in the background belongs with their other trips.
            setActiveTab(cancelled ? "find" : "trips");
          }}
          onAccepted={() => {
            const { rideId, tripId, driverName } = waitingOn;
            setWaitingOn(null);
            openLive(rideId, "rider", driverName, tripId);
          }}
        />
      )}

      {askForVehicle && (
        <VehiclePrompt
          user={user}
          onSave={async (details) => onUserChange(await api.profile.update(details))}
          onSkip={skipVehiclePrompt}
        />
      )}

      <RequestAlerts
        alerts={incoming.alerts}
        onAnswer={incoming.answer}
        onDismiss={incoming.dismiss}
        onOpenRequests={() => setActiveTab("requests")}
        onAccepted={(request) =>
          openLive(request.ride?.id, "driver", request.riderName, request.id)
        }
      />

      <aside className="app-sidebar">
        <button
          className="sidebar-brand"
          onClick={() => setActiveTab(admin ? (hasOps ? "ops" : "admin") : "home")}
          aria-label="Go to Home"
        >
          <Logo />
        </button>

        <div className="sidebar-status">
          <span className="sidebar-status-dot" />
          <div>
            <strong>Campus is moving</strong>
            <span>{rides.length} live hops on the board</span>
            {campus?.kmTravelled > 0 && (
              <span className="sidebar-status-km">
                {bigNumber(campus.kmTravelled)} km shared · {bigNumber(campus.ridesCompleted)} rides
              </span>
            )}
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {!admin && (
            <>
              <button className={activeTab === "home" ? "active" : ""} onClick={() => setActiveTab("home")}><span>⌂</span>Home</button>
              <button className={activeTab === "find" ? "active" : ""} onClick={() => setActiveTab("find")}><span>↗</span>Find a ride</button>
              <button className={activeTab === "offer" ? "active" : ""} onClick={() => setActiveTab("offer")}><span>＋</span>Offer a ride</button>
              <button className={activeTab === "campus" ? "active" : ""} onClick={() => setActiveTab("campus")}><span>✦</span>Campus</button>
              <button className={activeTab === "trips" ? "active" : ""} onClick={() => setActiveTab("trips")}><span>▣</span>My trips</button>
              <button className={activeTab === "requests" ? "active" : ""} onClick={() => setActiveTab("requests")}><span>♡</span>Requests{pendingCount > 0 && <b className="sidebar-badge">{pendingCount}</b>}</button>
            </>
          )}
          {hasOps && <button className={activeTab === "ops" ? "active" : ""} onClick={() => setActiveTab("ops")}><span>◈</span>Operations</button>}
          {hasConsole && <button className={activeTab === "admin" ? "active" : ""} onClick={() => setActiveTab("admin")}><span>⚙</span>Admin console</button>}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-profile">
          <button type="button" className={`sidebar-profile-button ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
            <div className="sidebar-avatar">{user?.name?.slice(0, 2).toUpperCase() || "YO"}</div>
            <div><strong>{user?.name || "You"}</strong><span>{user?.course || user?.role || "Campus member"}</span></div>
            {needsDetails(user) && <i className="profile-dot" aria-label="Details missing" />}
          </button>
          <button className="sidebar-logout" onClick={onLogout}><span>↪</span>Logout</button>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {!admin && <button className={activeTab === "home" ? "active" : ""} onClick={() => setActiveTab("home")}><span>⌂</span>Home</button>}
        {!admin && <button className={activeTab === "find" ? "active" : ""} onClick={() => setActiveTab("find")}><span>↗</span>Find</button>}
        {!admin && <button className="mobile-nav-main" onClick={() => setActiveTab("offer")}><span>＋</span>Hop</button>}
        {!admin && <button className={activeTab === "campus" ? "active" : ""} onClick={() => setActiveTab("campus")}><span>✦</span>Campus</button>}
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => setActiveTab("profile")}><span>●</span>You</button>
      </nav>

      <main className="dashboard-content">

  {ridesError && (
    <div className="api-error" role="alert">
      <strong>{ridesError}</strong>
      <button onClick={() => setRidesError("")} aria-label="Dismiss">×</button>
    </div>
  )}

  {activeTab === "home" && (
    <HomePage
      user={user}
      rides={rides}
      search={search}
      setSearch={setSearch}
      onFind={() => setActiveTab("find")}
      onOffer={() => setActiveTab("offer")}
      onCampus={() => setActiveTab("campus")}
      onTrips={() => setActiveTab("trips")}
      onRequest={requestRide}
      pendingRideId={pendingRideId}
      campus={campus}
    />
  )}

  {activeTab === "find" && (
  <FindRide
    rides={rides}
    onRequest={requestRide}
    initialSearch={search}
    pendingRideId={pendingRideId}
  />
)}

{activeTab === "offer" && (
  <OfferRide onPostRide={addRide} />
)}

{activeTab === "campus" && <CommunityPage campus={campus} />}

{activeTab === "trips" && (
  <MyTrips
    onViewTrip={(trip) => {
      setSelectedTrip(trip);
      setActiveTab("rideDetails");
    }}
    onTrackTrip={(trip) => openLive(trip.rideId, "rider", trip.person, trip.tripId)}
    onCancelled={(trip) => {
      markNoticeSeen(cancelKey(trip.tripId));
      loadRides();
      setRideNotice({
        kind: "cancelled",
        title: trip.status === "accepted" ? undefined : "Your request has been cancelled",
        message: `You cancelled the ${trip.status === "accepted" ? "ride" : "request"}. ${trip.person || "The driver"} has been told.`,
      });
    }}
  />
)}

{activeTab === "rideDetails" && (
  <RideDetails
    trip={selectedTrip}
    onBack={() => setActiveTab("trips")}
  />
)}

{activeTab === "requests" && (
  <IncomingRequests
    requests={incoming.requests}
    loading={incoming.loading}
    error={incoming.error}
    onAnswer={incoming.answer}
    onAccepted={(request) =>
      openLive(request.ride?.id, "driver", request.riderName, request.id)
    }
    // The same journey, reopened later. Accepting opens the live map
    // once; this is how the driver gets back to it afterwards.
    onOpenLive={(request) =>
      openLive(request.ride?.id, "driver", request.riderName, request.id)
    }
    onCancel={cancelAsDriver}
    nearby={
      // The same board the Find tab uses, and the same request flow: asking
      // from here opens the same waiting screen as asking from there.
      <NearbyRides
        rides={rides}
        onRequest={requestRide}
        pendingRideId={pendingRideId}
        onBrowseAll={() => setActiveTab("find")}
      />
    }
  />
)}

{activeTab === "profile" && (
  <SettingsPage
    user={user}
    onSave={async (details) => onUserChange(await api.profile.update(details))}
    onDeleted={onAccountDeleted}
  />
)}

{/* Guarded again at the point of render. A tab remembered in
    localStorage from an account that used to be an admin would
    otherwise come back after the privilege was removed. */}
{/* Rendered inside .ops-admin, which is what scopes that project's
    own stylesheet away from the console's. Its onBack goes to the
    console when there is one and to the profile when there is not —
    there is no commuter home to send an administrator to. */}
{activeTab === "ops" && hasOps && (
  <div className="ops-admin">
    <AdminDashboard
      onBack={() => setActiveTab(hasConsole ? "admin" : "profile")}
    />
  </div>
)}

{activeTab === "admin" && hasConsole && <AdminConsole user={user} />}

{activeTab === "live" && live && (
  <LiveRide
    rideId={live.rideId}
    requestId={live.requestId}
    role={live.role}
    withName={live.withName}

    // This screen is where a trip gets rated, so coming back from it is
    // exactly when the list behind it is stale. Both lists poll anyway;
    // this is so the card has already changed by the time it is looked
    // at rather than a few seconds later.
    onBack={() => {
      incoming.refresh(true);
      closeLive();
    }}
    onCancelled={() => {
      // The seat is gone, so the board and the driver's queue are both
      // stale. Refresh them on the way out.
      loadRides();
      incoming.refresh(true);
      leaveLiveForHome();
    }}
    onFinished={() => {
      loadRides();
      incoming.refresh(true);
      leaveLiveForHome();
    }}
    // The trip is over: nothing to restore on a reload or the next sign-in.
    onCompleted={forgetLiveRide}
  />
)}

</main>

    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);

  // Why you are being shown the sign-in form, when you did not ask for
  // it: you just registered, or you just changed your password.
  const [notice, setNotice] = useState("");

  // Carried from the sign-in form into the reset form, so somebody who
  // typed their address and then realised they had forgotten the password
  // does not type it again.
  const [resetEmail, setResetEmail] = useState("");

  // { email, name?, role? } between signing up and entering the code.
  const [pendingSignup, setPendingSignup] = useState(null);

  // Keep the first paint behind a tiny auth gate. In development we
  // intentionally start from a clean sign-in every time Vite boots: this
  // prevents an old Supabase session or a remembered live ride/tab from
  // dropping straight into a previous user's screen while developing.
  // Production keeps the normal Supabase session restore behaviour.
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Restarting the dev server is not a logout. Supabase already persists
    // the session, so restore it normally and let the dashboard fetch fresh
    // data. This also prevents a completed ride from reappearing because
    // the remembered live ride is validated inside Dashboard.


    const restore = async () => {
      // A reset link arrives as #access_token=...&type=recovery. Supabase
      // turns that into a session and fires PASSWORD_RECOVERY, but it is
      // a race against the restore below, which would otherwise see a
      // perfectly good session and walk into the dashboard — leaving
      // somebody who clicked "reset my password" signed in and no closer
      // to a new password. Reading the hash settles it before either.
      if (/type=recovery/.test(window.location.hash)) {
        setPage("resetPassword");
        setBooting(false);
        return;
      }

      const { data } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!data?.session) {
        setBooting(false);
        return;
      }

      try {
        // Who you are still comes from our own server, never from the
        // stored session — the token is only the proof.
        const profile = await api.profile.get();

        if (cancelled) return;

        setUser(profile);
        setPage("dashboard");
      } catch {
        // A stored session the API will not accept is no session at all.
        await supabase.auth.signOut();

        if (cancelled) return;

        setUser(null);
        setPage("login");
      } finally {
        if (!cancelled) setBooting(false);
      }
    };

    restore();

    // A token expiring or being revoked in another tab should land you on
    // the sign-in page rather than on a dashboard that 401s on every call.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setPage("login");
        return;
      }

      // Following the link from a reset email hands this tab a recovery
      // session. It is a side door: enough to set a new password and not
      // enough to be treated as signed in, so it routes to the form
      // rather than to the dashboard. Checked before the restore above
      // can decide this is an ordinary session.
      if (event === "PASSWORD_RECOVERY") {
        setUser(null);
        setBooting(false);
        setPage("resetPassword");
      }
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  if (booting) {
    return (
      <main className="auth-page auth-page--booting">
        <p className="route-status">Loading CampusHop…</p>
      </main>
    );
  }

  const login = (data) => {
    setNotice("");
    setUser(data);
    setPage("dashboard");
  };

  // Signed up, but not yet verified: no session exists until the code
  // Supabase emailed comes back.
  const register = (pending) => {
    setPendingSignup(pending);
    setPage("verifyEmail");
  };

  const verified = (profile) => {
    setPendingSignup(null);
    setUser(profile);
    setPage("profileSetup");
  };

  const completeProfile = async (profileData) => {
    // The server writes only to the caller's own profile row, and refuses
    // a driver without a vehicle number. Letting that refusal through to
    // the form is the point — swallowing it used to drop the user on the
    // dashboard with a profile that had not actually been saved.
    await api.profile.update(profileData);

    // Signing up used to walk straight into the dashboard on the session
    // the sign-up call happened to return. Ending at the sign-in form
    // instead means the password that was just chosen gets used once
    // while it is still fresh in mind — an account whose password was
    // never actually typed is one nobody can get back into. It is also
    // the only moment at which "did that work?" has a cheap answer.
    await supabase.auth.signOut();

    setUser(null);
    setNotice("Account created. Sign in to get going.");
    setPage("login");
  };

  if (page === "home") {
    return (
      <LandingPage
        onLogin={() => setPage("login")}
        onRegister={() => setPage("register")}
      />
    );
  }

  if (page === "login") {
    return (
      <LoginPage
        onLogin={login}
        onRegister={() => {
          setNotice("");
          setPage("register");
        }}
        onForgot={(typed) => {
          setResetEmail(typed || "");
          setNotice("");
          setPage("forgotPassword");
        }}
        onVerify={(email) => {
          setNotice("");
          setPendingSignup({ email });
          setPage("verifyEmail");
        }}
        notice={notice}
      />
    );
  }

  if (page === "verifyEmail" && pendingSignup) {
    return (
      <VerifyEmail
        email={pendingSignup.email}
        name={pendingSignup.name}
        role={pendingSignup.role}
        onVerified={verified}
        onBack={() => {
          setPendingSignup(null);
          setPage("login");
        }}
      />
    );
  }

  if (page === "forgotPassword") {
    return (
      <ForgotPassword
        email={resetEmail}
        onBack={() => setPage("login")}
        onVerified={() => setPage("resetPassword")}
      />
    );
  }

  if (page === "resetPassword") {
    return (
      <ResetPassword
        onDone={(message) => {
          setNotice(message);
          setPage("login");
        }}
      />
    );
  }

  if (page === "register") {
    return (
      <RegisterPage
        onBack={() => setPage("login")}
        onComplete={register}
      />
    );
  }

  if (page === "profileSetup") {
    return (
      <ProfileSetup
        onBack={() => setPage("register")}
        onComplete={completeProfile}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      onUserChange={setUser}
      onLogout={async () => {
        await supabase.auth.signOut();
        setUser(null);
        setNotice("");
        setPage("login");
      }}
      onAccountDeleted={async () => {
        // The auth user is already gone; this only clears the local copy.
        await supabase.auth.signOut().catch(() => {});
        setUser(null);
        setNotice("Your account has been deleted.");
        setPage("login");
      }}
    />
  );
}
