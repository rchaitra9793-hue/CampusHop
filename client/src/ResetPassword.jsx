import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import PasswordField from "./PasswordField";

const MIN_LENGTH = 8;

/**
 * Setting a new password, after following the link from the reset email.
 *
 * Reached only when Supabase has handed this tab a recovery session —
 * App.jsx watches for that event and routes here. The session is proof
 * enough, so this form never asks for the old password: the whole point is
 * that it is not known.
 *
 * Signing out afterwards is deliberate. A recovery session is a side door,
 * and leaving somebody logged in through it means the thing they just
 * proved they can do — change the password — was never actually tested
 * against the new one.
 */
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const problem = (() => {
    if (!password) return null;
    if (password.length < MIN_LENGTH) {
      return `Use at least ${MIN_LENGTH} characters.`;
    }
    if (confirm && password !== confirm) return "The two do not match.";
    return null;
  })();

  const submit = async (e) => {
    e.preventDefault();

    if (saving || problem || !password || password !== confirm) return;

    setSaving(true);
    setError("");

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    // Out through the front door this time.
    await supabase.auth.signOut();

    onDone("Password changed. Sign in with your new one.");
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">CH</div>

        <div>
          <span className="eyebrow">CAMPUS MOBILITY</span>
          <h1>
            New password.
            <br />
            <em>Last step.</em>
          </h1>
        </div>

        <div className="auth-note">
          <div className="note-tape" />
          <p>
            This link let you in once. Pick something you will remember and
            you are done.
          </p>
          <span>then sign in as usual</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <div className="mobile-brand">
            <div className="brand-mark">CH</div>
            <strong>CampusHop</strong>
          </div>

          <div className="auth-heading">
            <span className="eyebrow">CHOOSE A PASSWORD</span>
            <h2>Set a new one.</h2>
            <p>At least {MIN_LENGTH} characters.</p>
          </div>

          <form onSubmit={submit} className="auth-form">
            <PasswordField
              label="New password"
              name="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />

            <PasswordField
              label="Again, to be sure"
              name="confirm-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />

            {/* The local check first: it is about what has been typed, and
                saying so before the button is pressed beats a round trip
                that comes back with the same complaint. */}
            {problem && <p className="form-error">{problem}</p>}
            {!problem && error && <p className="form-error">{error}</p>}

            <button
              className="primary-button"
              type="submit"
              disabled={saving || Boolean(problem) || !password || !confirm}
            >
              {saving ? "Saving…" : "Save new password"}
              <span>→</span>
            </button>
          </form>

          <p className="auth-footer">
            You will be asked to sign in once with the new password, which is
            how you know it took.
          </p>
        </div>
      </section>
    </main>
  );
}
