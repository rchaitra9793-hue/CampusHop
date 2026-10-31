import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { cleanCode } from "./lib/campusEmail";

const RESEND_SECONDS = 60;

/**
 * Asking for a password reset, in two steps.
 *
 * First the address: Supabase Auth emails a one-time code to it. Then the
 * code: verifying it hands this tab a recovery session, and App.jsx moves
 * on to the page where the new password is chosen. Supabase generates,
 * sends and checks the code — it never passes through our server.
 *
 * The first step deliberately does not say whether the address was found.
 * "If that address has an account, a code is on its way" is the same
 * sentence either way — anything else turns this form into a way of
 * asking which of your classmates have signed up.
 */
export default function ForgotPassword({ email: initialEmail = "", onBack, onVerified }) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const address = email.trim().toLowerCase();

  const sendCode = async () => {
    // Back to wherever this app is actually being served from, for the
    // case where somebody follows the link in the email instead.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      address,
      { redirectTo: `${window.location.origin}/` }
    );

    // A rate limit is the one failure worth repeating back: the person
    // pressed the button twice and is owed an explanation rather than a
    // confirmation that never arrives.
    if (resetError && /rate|limit|seconds/i.test(resetError.message)) {
      setError(resetError.message);
      return false;
    }

    setWait(RESEND_SECONDS);
    return true;
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    if (busy || !address) return;

    setBusy(true);
    setError("");

    if (await sendCode()) setStep("code");
    setBusy(false);
  };

  const submitCode = async (e) => {
    e.preventDefault();
    if (busy || code.length < 6) return;

    setBusy(true);
    setError("");
    setInfo("");

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: address,
      token: code,
      type: "recovery",
    });

    if (verifyError) {
      setError(verifyError.message);
      setBusy(false);
      return;
    }

    onVerified();
  };

  const resend = async () => {
    if (wait > 0 || busy) return;
    setError("");
    setInfo("");
    if (await sendCode()) setInfo("A new code is on its way.");
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
            A one-time code goes to your campus address. It works once, and
            only for a short while.
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

          {step === "code" ? (
            <>
              <div className="auth-heading">
                <span className="eyebrow">ENTER CODE</span>
                <h2>Check your email.</h2>
                <p>
                  If <strong>{address}</strong> has a CampusHop account, a
                  reset code is on its way. Enter it below to choose a new
                  password.
                </p>
              </div>

              <form onSubmit={submitCode} className="auth-form">
                <label>
                  Reset code
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
                  {busy ? "Checking…" : "Continue"}
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

              <div className="auth-divider">
                <span>wrong address?</span>
              </div>

              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                  setInfo("");
                }}
              >
                Use a different email
              </button>
            </>
          ) : (
            <>
              <div className="auth-heading">
                <span className="eyebrow">RESET PASSWORD</span>
                <h2>Let's get you back.</h2>
                <p>Tell us the address you signed up with.</p>
              </div>

              <form onSubmit={submitEmail} className="auth-form">
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
                  disabled={busy || !address}
                >
                  {busy ? "Sending…" : "Send reset code"}
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
