import React, { useState, useEffect } from "react";
import Stars from "./Stars";
import { api } from "./lib/api";
import {
  VEHICLES,
  normalisePhone,
  normalisePlate,
  phoneProblem,
  plateProblem,
} from "./lib/vehicles";
import VehicleIcon from "./VehicleIcon";

/**
 * Your own details, and a place to fill in what is missing.
 *
 * The signup form and the catch-up prompt both ask for these once. This
 * is where they can be changed afterwards — a new phone, a different car,
 * or the fields an older account never filled in at all.
 */
export default function ProfilePage({ user, onSave }) {
  const [name, setName] = useState(user?.name || "");
  const [pickupPoint, setPickupPoint] = useState(user?.pickupPoint || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [vehicle, setVehicle] = useState(user?.vehicle || "none");
  const [vehicleNumber, setVehicleNumber] = useState(user?.vehicleNumber || "");
  const [capacity, setCapacity] = useState(String(user?.capacity || 1));

  // An administrator has no vehicle, no pickup point and no rating,
  // because they are not on the board — so this page is their name, the
  // address they sign in with, and what they are. Everything else below
  // belongs to somebody who actually shares rides.
  const admin = user?.isAdmin === true;

  // What people who rode with you thought. Somebody being scored by
  // strangers is owed sight of the result — and of the words, which come
  // back without a name on them.
  const [standing, setStanding] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (admin) return undefined;

    api.ratings
      .mine()
      .then((r) => !cancelled && setStanding(r))
      .catch(() => {
        // A database without 010 has nothing to report here.
      });

    return () => {
      cancelled = true;
    };
  }, [admin]);

  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const drives = vehicle !== "none";

  // What this account is still missing. Worth saying plainly rather than
  // leaving someone to notice an empty field.
  const gaps = [];

  if (!admin) {
    if (!user?.phone) gaps.push("a phone number");
    if (user?.vehicle && user.vehicle !== "none" && !user?.vehicleNumber) {
      gaps.push("a vehicle number");
    }
  }

  const submit = async (e) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name cannot be empty.");
      return;
    }

    // An administrator's form has one field on it. Validating a phone
    // number it never asked for, and then sending whatever happened to be
    // in state, is how a save fails over something nobody can see.
    if (admin) {
      setError("");
      setSaved(false);
      setSaving(true);

      try {
        await onSave({ name: name.trim() });
        setSaved(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }

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
      const plateIssue = plateProblem(plate);

      if (plateIssue) {
        setError(plateIssue);
        return;
      }
    }

    setError("");
    setSaved(false);
    setSaving(true);

    try {
      await onSave({
        name: name.trim(),
        pickupPoint: pickupPoint.trim(),
        phone: digits,
        vehicle,
        vehicleNumber: drives ? plate : "",
        capacity: drives ? Number(capacity || 1) : 0,
      });

      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="page-heading">
        <div>
          <span className="eyebrow">YOUR PROFILE</span>

          {admin ? (
            <>
              <h1>
                Your account,
                <br />
                <em>and nothing more.</em>
              </h1>

              <p>
                You administer CampusHop rather than ride on it, so there is
                no vehicle, pickup point or rating to keep here.
              </p>
            </>
          ) : (
            <>
              <h1>
                The details
                <br />
                <em>people go on.</em>
              </h1>

              <p>
                How you appear on the board, and how the person you are
                matched with reaches you.
              </p>
            </>
          )}
        </div>
      </section>

      {gaps.length > 0 && (
        <div className="profile-gap" role="status">
          <strong>Still missing: {gaps.join(" and ")}.</strong>
          <span>
            Without {gaps.length > 1 ? "these" : "this"}, someone you match
            with has no way to find or reach you.
          </span>
        </div>
      )}

      <form className="profile-form" onSubmit={submit}>
        <section className="profile-card">
          <h3>About you</h3>

          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          {/* A phone number is for the person you are travelling with to
              reach you, and a pickup point is where they find you. An
              administrator has neither. */}
          {!admin && (
            <>
              <label>
                Phone number
                <input
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

              <label>
                Default pickup point
                <input
                  type="text"
                  placeholder="e.g. Hostel Block C"
                  value={pickupPoint}
                  onChange={(e) => setPickupPoint(e.target.value)}
                />
              </label>
            </>
          )}

          <div className="profile-readonly">
            <div>
              <small>EMAIL</small>
              <strong>{user?.email || "—"}</strong>
            </div>

            <div>
              <small>ROLE</small>
              {/* The privilege, not the student/faculty label underneath
                  it: "administrator" is the answer to what this account
                  is, and the one the account holder is looking for. */}
              <strong>{admin ? "administrator" : user?.role || "student"}</strong>
            </div>

            {!admin && (
              <div>
                <small>YOUR RATING</small>
                <strong>
                  {standing?.average != null ? (
                    <Stars value={standing.average} count={standing.count} />
                  ) : (
                    <span className="stars stars--none">Not rated yet</span>
                  )}
                </strong>
              </div>
            )}
          </div>
        </section>

        {/* The comments, if there are any. Shown without names: a rating
            with "waited ten minutes at the gate" is useful, and knowing
            which of last week's riders wrote it turns it into a thing to
            settle rather than a thing to learn from. */}
        {!admin && standing?.received?.some((r) => r.comment) && (
          <section className="profile-card">
            <h3>What people said</h3>

            <ul className="rating-comments">
              {standing.received
                .filter((r) => r.comment)
                .map((r) => (
                  <li key={r.id}>
                    <Stars value={r.stars} size="small" />
                    <p>{r.comment}</p>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {!admin && (
        <section className="profile-card">
          <h3>What you drive</h3>

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

          {drives ? (
            <>
              <label>
                Vehicle number
                <input
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
                  Riders you accept use this to spot you at the pickup point.
                </span>
              </label>

              <label>
                Seats you can offer
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </label>

              <div className="profile-preview">
                <span className="live-vehicle-icon">
                  <VehicleIcon vehicle={vehicle} size={26} />
                </span>

                <div>
                  <small>RIDERS WILL LOOK FOR</small>
                  <strong>
                    {normalisePlate(vehicleNumber) || "your vehicle number"}
                  </strong>
                </div>
              </div>
            </>
          ) : (
            <p className="field-note">
              Pick a vehicle if you want to offer rides as well as find them.
            </p>
          )}
        </section>
        )}

        {error && <p className="form-error">{error}</p>}

        {saved && !error && <p className="profile-saved">Saved.</p>}

        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
          <span>→</span>
        </button>
      </form>
    </main>
  );
}
