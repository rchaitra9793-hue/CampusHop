import React, { useState } from "react";
import campushopLogo from "./assets/campushop-logo.png";
import {
  VEHICLES,
  normalisePlate,
  normalisePhone,
  plateProblem,
  phoneProblem,
} from "./lib/vehicles";
import VehicleIcon from "./VehicleIcon";

export default function ProfileSetup({ onBack, onComplete }) {
  const [vehicle, setVehicle] = useState("none");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const drives = vehicle !== "none";

  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();

    const digits = normalisePhone(phone);
    const phoneIssue = phoneProblem(digits);

    if (phoneIssue) {
      setError(phoneIssue);
      return;
    }

    const plate = normalisePlate(vehicleNumber);

    // Checked here as well as on the server: a rider looking for a car at
    // a kerb needs the number, so it is not an optional detail.
    if (drives) {
      const problem = plateProblem(plate);

      if (problem) {
        setError(problem);
        return;
      }
    }

    setError("");
    setSaving(true);

    try {
      await onComplete({
        pickupPoint: e.target.pickupPoint.value,
        phone: digits,
        vehicle,
        capacity: drives ? Number(e.target.capacity.value || 1) : 0,
        vehicleNumber: drives ? plate : "",
      });
    } catch (err) {
      // Stay on the form with the reason, rather than moving on from a
      // save that did not happen.
      setError(err.message);
      setSaving(false);
    }
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
          <span className="eyebrow">ALMOST THERE</span>
          <h1>
            Set your
            <br />
            <em>default route.</em>
          </h1>
        </div>

        <div className="sticker sticker-yellow">
          <span>03</span>
          set your
          <br />
          pickup point
        </div>

        <div className="sticker sticker-sage">
          <span>04</span>
          add a ride
          <br />
          if you have one
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-inner">
          <button className="back-button" onClick={onBack}>
            ← Back
          </button>

          <div className="auth-heading">
            <span className="eyebrow">PROFILE SETUP</span>
            <h2>Where do you usually start from?</h2>
            <p>This helps us match you with nearby rides.</p>
          </div>

          <form onSubmit={submit} className="auth-form">
            <label>
              Default pickup point
              <input
                name="pickupPoint"
                type="text"
                placeholder="e.g. Hostel Block C"
                required
              />
            </label>

            <label>
              Phone number
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="e.g. +91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <span className="field-note">
                Shared only with the driver or rider you are matched with —
                never shown on the ride board.
              </span>
            </label>

            <div>
              <span className="input-title">Do you have a vehicle?</span>

              <div className="role-grid">
                {VEHICLES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`role-option ${vehicle === option.value ? "selected" : ""}`}
                    onClick={() => setVehicle(option.value)}
                  >
                    <span className="role-icon">
                      <VehicleIcon vehicle={option.value} size={30} />
                    </span>
                    <strong>{option.title}</strong>
                    <small>{option.note}</small>
                  </button>
                ))}
              </div>
            </div>

            {drives && (
              <>
                <label>
                  Vehicle number
                  <input
                    name="vehicleNumber"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck="false"
                    placeholder="e.g. KA 05 MJ 1234"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                    required
                  />
                  <span className="field-note">
                    Shown to riders you accept, so they know which vehicle to
                    look for.
                  </span>
                </label>

                <label>
                  Seats available
                  <input
                    name="capacity"
                    type="number"
                    min="1"
                    max="6"
                    defaultValue="1"
                    placeholder="1"
                  />
                </label>
              </>
            )}

            {error && <p className="form-error">{error}</p>}

            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Continue to dashboard"}
              <span>→</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
