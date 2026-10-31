import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { api } from "./lib/api";
import { cleanCode } from "./lib/campusEmail";

const RESEND_SECONDS = 60;

/**
 * Confirming a new account with the code Supabase Auth emailed.
 *
 * Supabase generates, sends and checks the code; nothing about it passes
 * through our server. Verifying it is what gives this tab its first
 * session, so the profile row is only written afterwards, by an account
 * that has proved it owns the address.
 */
export default function VerifyEmail({ email, name, role, onVerified, onBack }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || code.length < 6) return;

    setBusy(true);
    setError("");
    setInfo("");

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    if (verifyError) {
      setError(verifyError.message);
      setBusy(false);
      return;
    }

    try {
      // Name and role are known when coming straight from the sign-up
      // form. Coming from sign-in they are not, and the server builds the
      // profile from what was stored at sign-up instead.
      if (name) await api.profile.create({ name, role });
      onVerified(await api.profile.get());
    } catch (err) {
      await supabase.auth.signOut();
      setError(err.message);
      setBusy(false);
    }
  };

  const resend = async () => {
    if (wait > 0) return;

    setError("");
    setInfo("");

    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    if (resendError) {
      setError(resendError.message);
      return;
    }

    setInfo("A new code is on its way.");
    setWait(RESEND_SECONDS);
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">CH</div>

        <div>
          <span className="eyebrow">CAMPUS MOBILITY</span>
          <h1>
            One code.
            <br />
            <em>You're in.</em>
          </h1>
        </div>

        <div className="auth-note">
          <div className="note-tape" />
          <p>
            We only let in addresses that can prove they belong to your
            campus.
          </p>
          <span>check your inbox</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <button className="back-button" type="button" onClick={onBack}>
            ← Back
          </button>

          <div className="auth-heading">
            <span className="eyebrow">VERIFY EMAIL</span>
            <h2>Check your email.</h2>
            <p>
              Enter the code sent to <strong>{email}</strong>.
            </p>
          </div>

          <form onSubmit={submit} className="auth-form">
            <label>
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(cleanCode(e.target.value))}
                required
                autoFocus
              />
            </label>

            {error && <p className="form-error">{error}</p>}
            {info && <p className="auth-notice">{info}</p>}

            <button
              className="primary-button"
              type="submit"
              disabled={busy || code.length < 6}
            >
              {busy ? "Verifying…" : "Verify email"}
              <span>→</span>
            </button>
          </form>

          <div className="form-row form-row--end">
            <button
              type="button"
              className="text-button"
              onClick={resend}
              disabled={wait > 0}
            >
              {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
            </button>
          </div>

          <p className="auth-footer">
            Nothing arrived? It can take a minute, and it sometimes lands in
            spam.
          </p>
        </div>
      </section>
    </main>
  );
}
