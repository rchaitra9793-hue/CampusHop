import React, { useMemo } from "react";
import AddressInput from "./AddressInput";
import RideCard from "./RideCard";
import CampusStats from "./CampusStats";

const VIBE = {
  music: "🎧 Music",
  chatty: "💬 Chatty",
  quiet: "🤫 Quiet",
  study: "📚 Study",
  chai: "☕ Chai stop",
};

const QUOTES = [
  "Your next teammate might be on your route.",
  "A spare seat can become a new connection.",
  "Same campus. Different circles.",
  "Fewer empty seats. More campus stories.",
  "Today: a ride. Tomorrow: a project partner?",
];

export default function HomePage({
  user,
  rides = [],
  search,
  setSearch,
  onFind,
  onOffer,
  onCampus,
  onTrips,
  onRequest,
  pendingRideId,
  campus,
}) {
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);
  const featured = useMemo(() => rides.slice(0, 3), [rides]);
  const course = user?.course || "your course";
  const firstName = (user?.name || "there").split(" ")[0];

  return (
    <main className="home-page home-page--new">
      <section className="home-welcome">
        <div>
          <div className="home-status-pill"><span /> CAMPUS IS MOVING · LIVE BOARD</div>
          <h1>Hey {firstName}.<br /><em>Where are we going?</em></h1>
          <p>Find a seat, offer a seat, or accidentally meet someone from a completely different course.</p>
        </div>
        <div className="home-note">
          <span>✦ TODAY'S CAMPUSHOP THOUGHT</span>
          <strong>“{quote}”</strong>
          <small>{course} · campus member</small>
        </div>
      </section>

      <CampusStats stats={campus} />

      <section className="home-search home-search--hero" id="home-search">
        <div className="home-search-topline">
          <div>
            <span className="eyebrow">01 · FIND YOUR NEXT HOP</span>
            <h2>Skip the menu. Start here.</h2>
          </div>
          <button type="button" className="quiet-link" onClick={onFind}>Open full search ↗</button>
        </div>
        <div className="home-search-grid">
          <AddressInput label="From" name="home-from" placeholder={user?.pickupPoint || "Pickup point"} value={search.from} onChange={(place) => setSearch((p) => ({ ...p, from: place }))} />
          <span className="search-arrow">→</span>
          <AddressInput label="To" name="home-to" placeholder="Campus / destination" value={search.to} onChange={(place) => setSearch((p) => ({ ...p, to: place }))} />
          <label className="home-time">ARRIVE BY<input type="time" value={search.arriveBy} onChange={(e) => setSearch((p) => ({ ...p, arriveBy: e.target.value }))} /></label>
          <button type="button" className="home-search-button" onClick={onFind} disabled={!search.from || !search.to}>Find a seat <span>↗</span></button>
        </div>
        <div className="search-shortcuts">
          <button type="button" onClick={onFind}>⌕ Search by route</button>
          <button type="button" onClick={onOffer}>＋ Offer your empty seat</button>
          <span>Routes · time · pickup · reliability</span>
        </div>
      </section>

      <section className="home-board-section home-section">
        <div className="section-intro section-intro--clean">
          <div><span className="eyebrow">02 · HOPS HAPPENING NOW</span><h2>People are already heading somewhere.</h2></div>
          <button type="button" className="text-link" onClick={onFind}>See every ride →</button>
        </div>
        {featured.length ? (
          <div className="home-ride-grid home-ride-grid--new">
            {featured.map((ride) => <RideCard key={ride.id} ride={ride} onRequest={onRequest} pending={pendingRideId === ride.id} />)}
          </div>
        ) : (
          <div className="home-empty home-empty--new">
            <div><span className="empty-spark">✦</span><strong>The board is quiet.</strong><p>Be the person who changes that. Your empty seat could save someone's commute.</p></div>
            <button type="button" onClick={onOffer}>Post your ride →</button>
          </div>
        )}
      </section>

      <section className="home-pulse">
        <div className="pulse-copy">
          <span className="eyebrow">03 · THE CAMPUS PULSE</span>
          <h2>Not just rides.<br /><em>People crossing paths.</em></h2>
          <p>Someone in CSE might know the exact project tool you need. Someone in ECE might be your next hackathon teammate. CampusHop makes those tiny encounters possible.</p>
          <div className="pulse-tags"><span>AIML</span><span>CSE</span><span>ECE</span><span>MECH</span><span>MBA</span></div>
          <button type="button" className="pulse-button" onClick={onCampus}>Explore your campus circle ✦</button>
        </div>
        <div className="pulse-visual" aria-label="Campus course network">
          <div className="pulse-ring pulse-ring--one" /><div className="pulse-ring pulse-ring--two" />
          <div className="pulse-center">YOU<small>at the centre</small></div>
          <span className="pulse-node pulse-node--1">AIML</span><span className="pulse-node pulse-node--2">CSE</span><span className="pulse-node pulse-node--3">ECE</span><span className="pulse-node pulse-node--4">MBA</span>
          <i className="pulse-line pulse-line--1" /><i className="pulse-line pulse-line--2" /><i className="pulse-line pulse-line--3" /><i className="pulse-line pulse-line--4" />
          <div className="pulse-caption">{rides.length ? `${rides.length} routes are currently floating around campus.` : "Your first route could start the network."}</div>
        </div>
      </section>

      <section className="home-action-grid">
        <article className="home-action-card home-action-card--passport">
          <span className="eyebrow">04 · YOUR CAMPUSHOP PASSPORT</span>
          <div className="passport-line"><div className="passport-avatar-home">{(user?.name || "YO").slice(0, 2).toUpperCase()}</div><div><strong>{user?.name || "You"}</strong><span>{course}</span></div></div>
          <div className="passport-mini-stats"><div><b>✦</b><span>First hop</span></div><div><b>🤝</b><span>Connections</span></div><div><b>🌱</b><span>Shared miles</span></div></div>
          <button type="button" className="text-link" onClick={onCampus}>Open passport →</button>
        </article>
        <article className="home-action-card home-action-card--vibe">
          <span className="eyebrow">05 · MAKE THE RIDE YOURS</span>
          <h3>Choose the vibe before you choose the seat.</h3>
          <div className="vibe-row-home">{Object.values(VIBE).map((label) => <span key={label}>{label}</span>)}</div>
          <p>Music, chatty, quiet, study mode or a chai stop. Tiny preference. Much better ride.</p>
          <button type="button" className="text-link" onClick={onOffer}>Offer a ride →</button>
        </article>
      </section>

      <section className="home-how home-how--new">
        <div><span className="eyebrow">06 · THE CAMPUSHOP LOOP</span><h2>Three little moments. One better commute.</h2></div>
        <div className="home-steps"><div><b>01</b><strong>Find a hop</strong><span>Search directly from Home.</span></div><div><b>02</b><strong>Cross paths</strong><span>Ride with someone outside your usual circle.</span></div><div><b>03</b><strong>Leave a signal</strong><span>Rate, connect, and keep the campus moving.</span></div></div>
      </section>

      <footer className="home-footer home-footer--new"><strong>CampusHop ✦</strong><span>Ride together. Go further.</span><button type="button" onClick={onTrips}>See my trips →</button></footer>
    </main>
  );
}
