import React, { useId, useState } from "react";

/**
 * A password box with a show/hide toggle.
 *
 * One component rather than the same two lines in four places: the login
 * form, the signup form and both boxes on the reset form. Typing a
 * password you cannot see is how a typo becomes "wrong password" with
 * nothing to say which character was wrong.
 *
 * Hidden again on every mount, never remembered. A revealed password that
 * survives a reload is one left on screen for whoever walks past next.
 *
 * Works uncontrolled too — RegisterPage reads its form by `name` rather
 * than holding state — so `value` and `onChange` are both optional.
 */
export default function PasswordField({
  label = "Password",
  name = "password",
  value,
  onChange,
  placeholder = "••••••••",
  autoFocus = false,
  autoComplete = "current-password",
  required = true,
  hint = null,
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <label className="password-field" htmlFor={id}>
      {label}
      {hint && <small>{hint}</small>}

      <span className="password-box">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
        />

        <button
          type="button"
          className="password-peek"
          onClick={() => setShown((was) => !was)}
          // The control says what it will do, which is the opposite of
          // what the icon shows — an eye with a line through it means
          // "hidden", and pressing it reveals.
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          title={shown ? "Hide password" : "Show password"}
          // Tabbing through a form should go email -> password -> submit.
          // This sits between the last two and is not a step on the way.
          tabIndex={-1}
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </span>
    </label>
  );
}

/* Drawn rather than imported: two paths weigh less than an icon set, and
   the app already draws its own vehicle and logo marks the same way. */

function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M1.8 12S5.4 5.5 12 5.5 22.2 12 22.2 12 18.6 18.5 12 18.5 1.8 12 1.8 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M1.8 12S5.4 5.5 12 5.5c1.3 0 2.5.2 3.5.6M20.4 9.2c1.2 1.4 1.8 2.8 1.8 2.8S18.6 18.5 12 18.5c-1.4 0-2.6-.3-3.7-.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3.1 3.1 0 0 0 4.2 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3.5 3.5l17 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
