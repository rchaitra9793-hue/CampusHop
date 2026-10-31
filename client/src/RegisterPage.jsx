import React, { useState } from "react";
import campushopLogo from "./assets/campushop-logo.png";
import { supabase } from "./supabaseClient";
import { isCampusEmail, CAMPUS_EMAIL_ERROR } from "./lib/campusEmail";
import PasswordField from "./PasswordField";

export default function RegisterPage({ onBack, onComplete }) {
  const [role, setRole] = useState("student");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const name = e.target.name.value.trim();
    const email = e.target.email.value.trim().toLowerCase();
    const password = e.target.password.value;

    if (!isCampusEmail(email)) {
      setError(CAMPUS_EMAIL_ERROR);
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      setLoading(false);
      return;
    }

    // Supabase Auth emails the verification code. Name and role ride along
    // as metadata so the server can still build the profile if the person
    // confirms later from the sign-in page.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // A session straight away means Supabase confirmed the address without
    // asking — "Confirm email" is off in the project. That would let an
    // unverified address in, so it is refused rather than used.
    if (data.session) {
      await supabase.auth.signOut();
      setError(
        "Email verification is turned off for this project. Turn on " +
          "\"Confirm email\" in Supabase → Authentication → Sign In / Providers → Email."
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    onComplete({ email, name, role });
  };

  return (
    <main className="auth-page register-page">
      <section className="auth-brand">
        <img
  src={campushopLogo}
  alt="CampusHop"
  className="campushop-logo"
/>

        <div>
          <span className="eyebrow">JOIN THE HOP</span>
          <h1>
            Same campus.
            <br />
            <em>Less traffic.</em>
          </h1>
        </div>

        <div className="sticker sticker-yellow">
          <span>01</span>
          verify
          <br />
          your campus
        </div>

        <div className="sticker sticker-sage">
          <span>02</span>
          find a
          <br />
          matching route
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <button className="back-button" onClick={onBack}>
            ← Back
          </button>

          <div className="auth-heading">
            <span className="eyebrow">CREATE ACCOUNT</span>
            <h2>Let's get you moving.</h2>
            <p>Use your institutional email to join your campus.</p>
          </div>

          <form onSubmit={submit} className="auth-form">
            <label>
              Full name
              <input
                name="name"
                type="text"
                placeholder="Your name"
                required
              />
            </label>

            <label>
              Campus email
              <input
                name="email"
                type="email"
                placeholder="you@college.edu.in"
                required
              />
            </label>

            <div>
              <span className="input-title">I am a</span>

              <div className="role-grid">
                <button
                  type="button"
                  className={`role-option ${
                    role === "student" ? "selected" : ""
                  }`}
                  onClick={() => setRole("student")}
                >
                  <span className="role-icon">🎒</span>
                  <strong>Student</strong>
                  <small>Find or offer rides</small>
                </button>

                <button
                  type="button"
                  className={`role-option ${
                    role === "faculty" ? "selected" : ""
                  }`}
                  onClick={() => setRole("faculty")}
                >
                  <span className="role-icon">📚</span>
                  <strong>Faculty</strong>
                  <small>Find or offer rides</small>
                </button>

                {/* Not a third kind of account, and deliberately not
                    selectable. There is no such thing as signing yourself
                    up as an administrator: this form could not grant it
                    if it tried, the API clamps the role it accepts to
                    student or faculty, and neither admin gate reads
                    anything this page can set. It is shown greyed so the
                    question "where is Admin?" has a visible answer. */}
                <button
                  type="button"
                  className="role-option role-option--portal"
                  disabled
                  title="Administrators are appointed, not self-registered"
                >
                  <span className="role-icon">🛠️</span>
                  <strong>Admin</strong>
                  <small>Appointed, not self-signed-up</small>
                </button>
              </div>

              <p className="field-note">
                Administrator access is granted by an existing administrator
                — either in the console here, or by adding the address to the
                operations dashboard's own list. Sign up as a student or
                faculty member, and it is added to that account.
              </p>
            </div>

            <PasswordField
              name="password"
              placeholder="Create a password"
              autoComplete="new-password"
            />

            {error && <p className="form-error">{error}</p>}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
              <span>→</span>
            </button>
          </form>

          <p className="verification-note">
            <span>✓</span>
            We'll email a verification code to your campus address.
          </p>
        </div>
      </section>
    </main>
  );
}