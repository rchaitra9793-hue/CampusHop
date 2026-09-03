import React, { useState, useEffect, useCallback } from "react";
import LandingPage from "./LandingPage";
import LoginPage from "./LoginPage";
import RegisterPage from "./RegisterPage";
import campushopLogo from "./assets/campushop-logo.png";
import { supabase } from "./supabaseClient";
import { api } from "./lib/api";
import RideCard from "./RideCard";
import AddressInput from "./AddressInput";

import FindRide from "./FindRide";
import OfferRide from "./OfferRide";
import MyTrips from "./MyTrips";
import RideDetails from "./RideDetails";
import ProfileSetup from "./ProfileSetup";
import IncomingRequests from "./IncomingRequests";
import RequestAlerts from "./RequestAlerts";
import VehiclePrompt from "./VehiclePrompt";
import LiveRide from "./LiveRide";
import RequestWaiting from "./RequestWaiting";
import ProfilePage from "./ProfilePage";
import { useIncomingRequests } from "./lib/useIncomingRequests";
import { needsDetails } from "./lib/vehicles";

// Cycled so a board of rides keeps the pinned-note look.
const ACCENTS = ["coral", "sage", "lavender"];
const ROTATIONS = ["-0.8deg", "0.6deg", "-0.4deg"];

// The tabs worth returning to. `rideDetails` is deliberately absent: it
// needs a trip picked in memory, so restoring it would land on an empty
// page. It falls back to the list it was opened from.
const TABS = ["home", "find", "offer", "trips", "requests", "profile"];
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

function rememberedTab() {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return TABS.includes(stored) ? stored : "home";
  } catch {
    return "home";
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

function Dashboard({ user, onLogout, onUserChange }) {
  // Reloading should put you back where you were, not at the top of the
  // app. Read once, on the way in.
  const [live, setLive] = useState(rememberedLive);
  const [activeTab, setActiveTab] = useState(() =>
    rememberedLive() ? "live" : rememberedTab()
  );

  useEffect(() => {
    try {
      // Only the real tabs are worth remembering; see TABS above.
      if (TABS.includes(activeTab)) localStorage.setItem(TAB_KEY, activeTab);
    } catch {
      // Storage unavailable — the tab simply will not survive a reload.
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      if (live) localStorage.setItem(LIVE_KEY, JSON.stringify(live));
      else localStorage.removeItem(LIVE_KEY);
    } catch {
      // As above.
    }
  }, [live]);

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

  // Requests are polled once here, for the whole dashboard, so a driver
  // hears about one wherever they happen to be.
  const incoming = useIncomingRequests(user?.id);

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

  const askForVehicle = needsDetails(user) && !vehiclePromptSkipped;

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

  // The board shown on the dashboard. Ranking and filtering happen in the
  // API; here we just ask for everything and paint it.
  const loadRides = useCallback(async () => {
    try {
      const { rides: rows } = await api.rides.list();

      setRides(
        rows.map((ride, i) => ({
          ...ride,
          accent: ACCENTS[i % ACCENTS.length],
          rotation: ROTATIONS[i % ROTATIONS.length],
        }))
      );

      setRidesError("");
    } catch (err) {
      setRidesError(err.message);
    }
  }, []);

  useEffect(() => {
    loadRides();
  }, [loadRides]);

  // Re-fetch rather than splicing a local copy, so what is on screen is
  // always what the server actually stored.
  const addRide = () => {
    loadRides();
    setActiveTab("home");
  };

  const pendingCount = incoming.requests.filter((r) => r.status === "pending").length;

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

      <header className="topbar">
        <button
  className="logo-button"
  onClick={() => setActiveTab("home")}
>
  <Logo />
</button>

        <nav className="main-nav">
          <button
  className={activeTab === "find" ? "active" : ""}
  onClick={() => setActiveTab("find")}
>
  Find a ride
</button>

          <button
            className={activeTab === "offer" ? "active" : ""}
            onClick={() => setActiveTab("offer")}
          >
            Offer a ride
          </button>

          <button
            className={activeTab === "trips" ? "active" : ""}
            onClick={() => setActiveTab("trips")}
          >
            My trips
          </button>

          <button
            className={activeTab === "requests" ? "active" : ""}
            onClick={() => setActiveTab("requests")}
          >
            Requests
            {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </button>
        </nav>

        <div className="profile-menu">
          <button
            type="button"
            className={`profile-button ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => setActiveTab("profile")}
            title="Your profile"
          >
            <div className="mini-avatar">
              {user?.name?.slice(0, 2).toUpperCase() || "YO"}
            </div>

            <div>
              <strong>{user?.name || "You"}</strong>
              <span>{user?.role || "Student"}</span>
            </div>

            {/* A profile with gaps is worth flagging where it is fixed. */}
            {needsDetails(user) && <span className="profile-dot" aria-label="Details missing" />}
          </button>

          <button className="logout-button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-content">

  {ridesError && (
    <div className="api-error" role="alert">
      <strong>{ridesError}</strong>
      <button onClick={() => setRidesError("")} aria-label="Dismiss">×</button>
    </div>
  )}

  {activeTab === "home" && (
    <>
      <section className="welcome-row">
          <div>
            <span className="eyebrow">MONDAY · AUGUST 24</span>
            <h1>
              Good evening,
              <br />
              <em>{user?.name?.split(" ")[0] || "rider"}.</em>
            </h1>
          </div>

          <div className="campus-status">
            <span className="status-dot" />
            <div>
              <strong>Campus network</strong>
              <span>Verified & active</span>
            </div>
          </div>
        </section>

        <section className="commute-panel">
          <div className="commute-copy">
            <span className="eyebrow">YOUR MORNING COMMUTE</span>
            <h2>Where are you headed?</h2>
            <p>
              Tell us your route and we'll find people already going your way.
            </p>
          </div>

          <div className="commute-form commute-form--live">
            <AddressInput
              label="From"
              name="home-from"
              placeholder={user?.pickupPoint || "e.g. BTM Layout"}
              value={search.from}
              onChange={(place) =>
                setSearch((prev) => ({ ...prev, from: place }))
              }
            />

            <AddressInput
              label="To"
              name="home-to"
              placeholder="e.g. BMS College of Engineering"
              value={search.to}
              onChange={(place) => setSearch((prev) => ({ ...prev, to: place }))}
            />

            <label className="search-field">
              Arrive by
              <input
                type="time"
                value={search.arriveBy}
                onChange={(e) =>
                  setSearch((prev) => ({ ...prev, arriveBy: e.target.value }))
                }
              />
            </label>

            <button
              className="find-button"
              onClick={() => setActiveTab("find")}
              disabled={!search.from || !search.to}
            >
              Find matches
              <span>↗</span>
            </button>
          </div>
        </section>

        <section className="matches-header">
          <div>
            <span className="eyebrow">ROUTE BOARD</span>
            <h2>People heading your way.</h2>
          </div>

          <div className="match-explanation">
            <div className="tiny-score">{rides.length}</div>
            <span>
              routes posted.
              <br />
              Search above to rank them.
            </span>
          </div>
        </section>

        <section className="ride-board">
          <div className="board-scribble">
            <span>best matches</span>
            <div>↘</div>
          </div>

          {rides.map((ride) => (
            <RideCard
              key={ride.id}
              ride={ride}
              onRequest={requestRide}
              pending={pendingRideId === ride.id}
            />
          ))}
        </section>

        <section className="score-breakdown">
          <div>
            <span className="eyebrow">HOW WE SCORE</span>
            <h2>Not magic. Just useful.</h2>
            <p>
              Every match is explainable. We compare the things that actually
              matter when sharing a commute.
            </p>
          </div>

          <div className="score-factors">
            <div>
              <strong>35%</strong>
              <span>Route</span>
            </div>

            <div>
              <strong>25%</strong>
              <span>Time</span>
            </div>

            <div>
              <strong>20%</strong>
              <span>Pickup</span>
            </div>

            <div>
              <strong>15%</strong>
              <span>Reliability</span>
            </div>

            <div>
              <strong>5%</strong>
              <span>Vehicle</span>
            </div>
          </div>
                </section>
    </>
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

{activeTab === "trips" && (
  <MyTrips
    onViewTrip={(trip) => {
      setSelectedTrip(trip);
      setActiveTab("rideDetails");
    }}
    onTrackTrip={(trip) => openLive(trip.rideId, "rider", trip.person, trip.tripId)}
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
  />
)}

{activeTab === "profile" && (
  <ProfilePage
    user={user}
    onSave={async (details) => onUserChange(await api.profile.update(details))}
  />
)}

{activeTab === "live" && live && (
  <LiveRide
    rideId={live.rideId}
    requestId={live.requestId}
    role={live.role}
    withName={live.withName}
    onBack={closeLive}
    onCancelled={() => {
      // The seat is gone, so the board and the driver's queue are both
      // stale. Refresh them on the way out.
      loadRides();
      incoming.refresh(true);
      closeLive();
    }}
  />
)}

</main>

    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);

  // Supabase keeps the session in local storage, so a reload still has a
  // valid token — but this component used to start from a blank `user`
  // and drop straight back to the landing page. Restoring it here is what
  // makes a refresh keep you signed in.
  //
  // `booting` holds the first paint until we know: without it the landing
  // page flashes for a moment before the dashboard replaces it.
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
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
    setUser(data);
    setPage("dashboard");
  };

  const register = (data) => {
    setUser(data);
    setPage("profileSetup");
  };

  const completeProfile = async (profileData) => {
    // The server writes only to the caller's own profile row, and refuses
    // a driver without a vehicle number. Letting that refusal through to
    // the form is the point — swallowing it used to drop the user on the
    // dashboard with a profile that had not actually been saved.
    setUser(await api.profile.update(profileData));
    setPage("dashboard");
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
        onRegister={() => setPage("register")}
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
        setPage("login");
      }}
    />
  );
}
