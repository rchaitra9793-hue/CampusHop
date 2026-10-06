import React, { useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Asking for a password reset link.
 *
 * Supabase mails a one-time link back to the address given; following it
 * returns to this app with a recovery session, which is what lets the new
 * password be set without knowing the old one. App.jsx listens for that.
 *
 * The confirmation deliberately does not say whether the address was
 * found. "If that address has an account, a link is on its way" is the
 * same sentence either way — anything else turns this form into a way of
 * asking which of your classmates have signed up.
 */
export default function ForgotPassword({ email: initialEmail = "", onBack }) {
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();

    if (sending) return;

    setSending(true);
    setError("");

    // Back to wherever this app is actually being served from, so a link
    // opened on a phone does not try to return to somebody's localhost.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/` }
    );

    // A rate limit is the one failure worth repeating back: the person
    // pressed the button twice and is owed an explanation rather than a
    // confirmation that never arrives.
    if (resetError && /rate|limit|seconds/i.test(resetError.message)) {
      setError(resetError.message);
      setSending(false);
      return;
    }

    setSent(true);
    setSending(false);
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">CH</div>

        <div>
          <span className="eyebrow">CAMPUS MOBILITY</span>
          <h1>
            Locked out?
            <br />
            <em>Happens.</em>
          </h1>
        </div>

        <div className="auth-note">
          <div className="note-tape" />
          <p>
            A reset link goes to your campus address. It works once, and only
            for a short while.
          </p>
          <span>check your inbox</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <div className="mobile-brand">
            <div className="brand-mark">CH</div>
            <strong>CampusHop</strong>
          </div>

          {sent ? (
            <>
              <div className="auth-heading">
                <span className="eyebrow">ON ITS WAY</span>
                <h2>Check your email.</h2>
                <p>
                  If <strong>{email.trim()}</strong> has a CampusHop account, a
                  reset link is on its way. Open it on this device and you can
                  pick a new password.
                </p>
              </div>

              <p className="auth-footer">
                Nothing arrived? It can take a minute, and it sometimes lands in
                spam. The link expires, so ask again if it has been a while.
              </p>

              <button className="primary-button" type="button" onClick={onBack}>
                Back to sign in
                <span>→</span>
              </button>
            </>
          ) : (
            <>
              <div className="auth-heading">
                <span className="eyebrow">RESET PASSWORD</span>
                <h2>Let's get you back.</h2>
                <p>Tell us the address you signed up with.</p>
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
                    autoFocus
                  />
                </label>

                {error && <p className="form-error">{error}</p>}

                <button
                  className="primary-button"
                  type="submit"
                  disabled={sending || !email.trim()}
                >
                  {sending ? "Sending…" : "Send reset link"}
                  <span>→</span>
                </button>
              </form>

              <div className="auth-divider">
                <span>remembered it?</span>
              </div>

              <button className="secondary-button" type="button" onClick={onBack}>
                Back to sign in
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
