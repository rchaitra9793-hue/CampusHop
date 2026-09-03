import React from "react";
import campushopLogo from "./assets/campushop-logo.png";

export default function LandingPage({ onLogin, onRegister }) {
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <img
          src={campushopLogo}
          alt="CampusHop"
          className="campushop-logo"
        />

        <div>
          <span className="eyebrow">CAMPUS MOBILITY</span>
          <h1>
            Your route.
            <br />
            <em>Shared.</em>
          </h1>
        </div>

        <div className="auth-note">
          <div className="note-tape" />
          <p>
            A private ride-sharing space for people who already belong to
            the same campus.
          </p>
          <span>students + faculty only</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <div className="mobile-brand">
            <img
              src={campushopLogo}
              alt="CampusHop"
              className="campushop-logo"
            />
          </div>

          <div className="auth-heading">
            <span className="eyebrow">WELCOME</span>
            <h2>Get moving on campus.</h2>
            <p>Find a ride, offer a ride — all within your own campus.</p>
          </div>

          <button className="primary-button" onClick={onLogin}>
            Log in
            <span>→</span>
          </button>

          <div className="auth-divider">
            <span>new around here?</span>
          </div>

          <button className="secondary-button" onClick={onRegister}>
            Create campus account
          </button>

          <p className="auth-footer">
            Access is limited to verified members of your institution.
          </p>
        </div>
      </section>
    </main>
  );
}
