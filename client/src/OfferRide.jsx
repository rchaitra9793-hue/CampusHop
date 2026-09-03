import React, { useEffect, useState } from "react";
import { api } from "./lib/api";
import AddressInput from "./AddressInput";
import RouteMap from "./RouteMap";
import { computeRoute, formatDistance, formatDuration } from "./lib/geo";

export default function OfferRide({ onPostRide }) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);

  // Resolved places (with coordinates), kept apart from the plain fields.
  const [pickupPlace, setPickupPlace] = useState(null);
  const [dropoffPlace, setDropoffPlace] = useState(null);

  // The computed route is previewed before posting and then reused on
  // submit, so posting a ride costs exactly one routing request.
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);

  const [form, setForm] = useState({
    date: "",
    time: "",
    seats: "2",
    vehicle: "car",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Route as soon as both ends are known, so the driver sees the real
  // roads before committing.
  useEffect(() => {
    if (!pickupPlace || !dropoffPlace) {
      setRoute(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setRouting(true);
      setError("");

      try {
        const result = await computeRoute(pickupPlace, dropoffPlace);
        if (!cancelled) setRoute(result);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setRoute(null);
        }
      } finally {
        if (!cancelled) setRouting(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [pickupPlace, dropoffPlace]);

  const resetForm = () => {
    setPickupPlace(null);
    setDropoffPlace(null);
    setRoute(null);
    setForm({ date: "", time: "", seats: "2", vehicle: "car" });
  };

  const submitRide = async (e) => {
    e.preventDefault();
    setError("");

    if (!pickupPlace || !dropoffPlace) {
      setError("Pick both locations from the suggestions so we can map the route.");
      return;
    }

    setPosting(true);

    try {
      // Only the places and the schedule are sent. The server recomputes
      // the route itself and takes the driver from the access token, so
      // nothing here can be forged by the browser.
      await api.rides.create({
        pickup: pickupPlace,
        dropoff: dropoffPlace,
        date: form.date,
        time: form.time,
        seats: Number(form.seats),
        vehicle: form.vehicle,
      });

      setSubmitted(true);
      resetForm();
      onPostRide();
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <main className="page-shell">

      <section className="page-heading offer-heading">
        <div>
          <span className="eyebrow">OFFER A RIDE</span>

          <h1>
            Got a seat?
            <br />
            <em>Share the hop.</em>
          </h1>

          <p>
            Add your commute and let people on your campus
            discover your route.
          </p>
        </div>
      </section>

      <section className="offer-layout">

        <form
          className="offer-form"
          onSubmit={submitRide}
        >

          {/* ROUTE */}

          <div className="form-section">
            <span className="form-number">01</span>

            <div>
              <h3>Your route</h3>

              <AddressInput
                label="Pickup location"
                name="pickup"
                placeholder="e.g. BTM Layout"
                value={pickupPlace}
                onChange={setPickupPlace}
                mapTitle="Where are you setting off from?"
                required
              />

              <AddressInput
                label="Destination"
                name="dropoff"
                placeholder="e.g. BMS College of Engineering"
                value={dropoffPlace}
                onChange={setDropoffPlace}
                mapTitle="Where are you headed?"
                required
              />

              {routing && (
                <p className="route-status">Finding the road route…</p>
              )}

              {/* Shown as soon as either end is chosen. Waiting for the
                  full route meant a driver could pick a pickup point and
                  get no confirmation of where it had landed. */}
              {(route || pickupPlace || dropoffPlace) && (
                <div className="route-preview">
                  {route && (
                    <div className="route-preview-stats">
                      <div>
                        <small>DISTANCE</small>
                        <strong>{formatDistance(route.distanceMeters)}</strong>
                      </div>

                      <div>
                        <small>DRIVE TIME</small>
                        <strong>{formatDuration(route.durationSeconds)}</strong>
                      </div>
                    </div>
                  )}

                  <RouteMap
                    geometry={route?.geometry}
                    markers={[
                      pickupPlace && {
                        lngLat: [pickupPlace.lng, pickupPlace.lat],
                        kind: "pickup",
                        label: `From: ${pickupPlace.label}`,
                      },
                      dropoffPlace && {
                        lngLat: [dropoffPlace.lng, dropoffPlace.lat],
                        kind: "dropoff",
                        label: `To: ${dropoffPlace.label}`,
                      },
                    ].filter(Boolean)}
                    height={220}
                  />
                </div>
              )}
            </div>
          </div>

          {/* DATE + TIME */}

          <div className="form-section">
            <span className="form-number">02</span>

            <div>
              <h3>When are you leaving?</h3>

              <div className="form-two-column">

                <label>
                  Date

                  <input
                    type="date"
                    name="date"
                    value={form.date}
                    onChange={handleChange}
                    required
                  />
                </label>

                <label>
                  Departure

                  <input
                    type="time"
                    name="time"
                    value={form.time}
                    onChange={handleChange}
                    required
                  />
                </label>

              </div>
            </div>
          </div>

          {/* RIDE DETAILS */}

          <div className="form-section">
            <span className="form-number">03</span>

            <div>
              <h3>Ride details</h3>

              <div className="form-two-column">

                <label>
                  Available seats

                  <select
                    name="seats"
                    value={form.seats}
                    onChange={handleChange}
                  >
                    <option value="1">1 seat</option>
                    <option value="2">2 seats</option>
                    <option value="3">3 seats</option>
                    <option value="4">4 seats</option>
                  </select>
                </label>

                <label>
                  Vehicle

                  <select
                    name="vehicle"
                    value={form.vehicle}
                    onChange={handleChange}
                  >
                    <option value="car">Car</option>
                    <option value="bike">Bike</option>
                    <option value="scooty">Scooty</option>
                  </select>
                </label>

              </div>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <button
            className="primary-button offer-submit"
            type="submit"
            disabled={posting || routing}
          >
            {posting ? "Posting…" : "Post my ride"}
            <span>→</span>
          </button>

        </form>

        <aside className="offer-note">

          <div className="offer-sticker">
            HOP
          </div>

          <span className="eyebrow">
            WHY SHARE?
          </span>

          <h2>
            One empty seat
            <br />
            can change
            <br />
            someone&apos;s commute.
          </h2>

          <p>
            Your route stays visible only to verified
            members of your campus.
          </p>

        </aside>

      </section>

      {submitted && (
        <div
          className="success-message"
          onClick={() => setSubmitted(false)}
        >
          <strong>Ride posted!</strong>

          <span>
            Your route is now visible to matching riders.
          </span>
        </div>
      )}

    </main>
  );
}
