import React, { useState } from "react";
import {
  VEHICLES,
  normalisePlate,
  normalisePhone,
  plateProblem,
  phoneProblem,
} from "./lib/vehicles";

/**
 * Asks an existing account for the details signup now collects.
 *
 * Every account created before those questions existed has a gap: no
 * phone number, no vehicle answer, or a driver posting rides with no
 * number plate on file. Each of those leaves someone standing at a kerb
 * unable to find or reach the person they are meeting, so this catches
 * up the older accounts rather than leaving them half-filled.
 *
 * Skippable — nobody should be locked out of the app over it — but it
 * comes back next session while the gap remains.
 */
export default function VehiclePrompt({ user, onSave, onSkip }) {
  // An account that was never asked starts unanswered; a driver missing
  // only a plate starts on the vehicle they already told us about.
  const [vehicle, setVehicle] = useState(user?.vehicle ?? null);
  const [vehicleNumber, setVehicleNumber] = useState(user?.vehicleNumber || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [capacity, setCapacity] = useState(String(user?.capacity || 1));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const drives = vehicle != null && vehicle !== "none";

  const submit = async (e) => {
    e.preventDefault();

    if (vehicle == null) {
      setError("Pick one so we know how to match you.");
      return;
    }

    const digits = normalisePhone(phone);
    const phoneIssue = phoneProblem(digits);

    if (phoneIssue) {
      setError(phoneIssue);
      return;
    }

    const plate = normalisePlate(vehicleNumber);

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
      await onSave({
        phone: digits,
        vehicle,
        capacity: drives ? Number(capacity || 1) : 0,
        vehicleNumber: drives ? plate : "",
      });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="request-modal vehicle-prompt" onSubmit={submit}>
        <div className="modal-sticker">HOP!</div>

        <span className="eyebrow">ONE QUICK THING</span>

        <h2>A couple of details</h2>

        <p>
          {user?.vehicle && user.vehicle !== "none" && !user?.vehicleNumber
            ? "You're offering rides, but we never took your vehicle number. Riders use it to spot you at the pickup point."
            : "We ask everyone for these now. They decide how you get matched, and how the person you're meeting reaches you."}
        </p>

        <label className="prompt-field">
          Phone number
          <input
            type="tel"
            autoComplete="tel"
            placeholder="e.g. +91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <span className="field-note">
            Shared only with the driver or rider you are matched with.
          </span>
        </label>

        <span className="input-title prompt-question">Do you have a vehicle?</span>

        <div className="role-grid">
          {VEHICLES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`role-option ${vehicle === option.value ? "selected" : ""}`}
              onClick={() => setVehicle(option.value)}
            >
              <span className="role-icon">{option.icon}</span>
              <strong>{option.title}</strong>
              <small>{option.note}</small>
            </button>
          ))}
        </div>

        {drives && (
          <>
            <label className="prompt-field">
              Vehicle number
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                placeholder="e.g. KA 05 MJ 1234"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                autoFocus
              />
            </label>

            <label className="prompt-field">
              Seats you can offer
              <input
                type="number"
                min="1"
                max="6"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onSkip}>
            Not now
          </button>

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving…" : "Save →"}
          </button>
        </div>
      </form>
    </div>
  );
}
