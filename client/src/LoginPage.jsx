import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { api } from "./lib/api";
import PasswordField from "./PasswordField";

export default function LoginPage({ onLogin, onRegister, onForgot, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Which of the two the person thinks they are. It changes the note
  // under the picker and nothing else: the form, the request and the
  // server's answer are identical either way.
  const [who, setWho] = useState("campus");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
      return;
    }

    // Signing in is the one thing still done against Supabase directly;
    // it yields the token every API call is then made with. Who the user
    // is comes back from our own server.
    try {
      onLogin(await api.profile.get());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">CH</div>

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
            A private ride-sharing space for people who already belong to the
            same campus.
          </p>
          <span>students + faculty only</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <div className="mobile-brand">
            <div className="brand-mark">CH</div>
            <strong>CampusHop</strong>
          </div>

          <div className="auth-heading">
            <span className="eyebrow">WELCOME BACK</span>
            <h2>Hop back in.</h2>
            <p>Sign in with your institutional account.</p>
          </div>

          {/* Carried in from registering or from resetting a password, so
              the reason you are looking at a sign-in form is on the form
              rather than left to be inferred. */}
          {notice && <p className="auth-notice">{notice}</p>}

          {/* Who is signing in — one form either way. It is the same
              sign-in for all three, and what you see afterwards is
              decided by the server from the account itself, never from
              this choice. It is here because people look for it. */}
          <div className="signin-as">
            <span className="input-title">Signing in as</span>

            <div className="role-grid role-grid--signin">
              <button
                type="button"
                className={`role-option ${who === "campus" ? "selected" : ""}`}
                onClick={() => setWho("campus")}
              >
                <span className="role-icon">🎒</span>
                <strong>Student or faculty</strong>
                <small>Find or offer rides</small>
              </button>

              <button
                type="button"
                className={`role-option ${who === "admin" ? "selected" : ""}`}
                onClick={() => setWho("admin")}
              >
                <span className="role-icon">🛠️</span>
                <strong>Admin</strong>
                <small>Operations and moderation</small>
              </button>
            </div>

            {/* Said plainly, because a role picker that grants a role is
                exactly what this is not. Picking Admin changes nothing
                about what the form does or what the server will allow. */}
            {who === "admin" && (
              <p className="field-note">
                Sign in with your administrator account below. The dashboard
                opens by itself — this choice grants nothing, and an account
                without the privilege sees the usual ride board.
              </p>
            )}
          </div>

          <form onSubmit={submit} className="auth-form">
            <label>
              Campus email
              <input
                type="email"
                placeholder="you@college.edu.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <PasswordField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            {/* "Remember me" used to sit here as an unwired checkbox.
                Supabase already keeps the session in local storage, so it
                promised nothing it was not doing anyway and offered no way
                to turn it off — a control that cannot change anything is
                worse than no control. */}
            <div className="form-row form-row--end">
              <button
                type="button"
                className="text-button"
                onClick={() => onForgot(email)}
              >
                Forgot password?
              </button>
            </div>

            {error && <p className="form-error">{error}</p>}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
              <span>→</span>
            </button>
          </form>

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