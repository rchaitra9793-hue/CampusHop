import React, { useEffect, useState } from "react";
import { api } from "./lib/api";
import Stars from "./Stars";

// What each number means, said plainly. A scale where only the ends are
// labelled leaves the middle to guess at, and three is the one people most
// want to be sure about before they pick it.
const MEANINGS = {
  1: "Went badly",
  2: "Not great",
  3: "Fine",
  4: "Good",
  5: "Couldn't have gone better",
};

/**
 * Rating the person you travelled with, inline.
 *
 * This is the panel on the end-of-ride screen rather than a modal reached
 * from a button in a list. The moment a trip finishes is the moment both
 * people have an opinion about it and are still looking at the app; asking
 * then costs nobody a second visit, and a rating nobody is asked for is a
 * rating nobody gives.
 *
 * It is the same component for both sides. There are two people on a trip
 * and the server works out which one is rating, so nothing here names a
 * subject.
 */
export default function RatePanel({ tripId, role = "rider", withName, onSaved }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const isDriver = role === "driver";
  const them = withName || (isDriver ? "your rider" : "your driver");

  // What they already put, if anything. Loaded so the panel opens showing
  // the verdict rather than asking for one that has been given.
  useEffect(() => {
    let cancelled = false;

    if (!tripId) {
      setLoading(false);
      return;
    }

    api.ratings
      .forTrip(tripId)
      .then((rating) => {
        if (cancelled || !rating) return;

        setSaved(rating);
        setStars(rating.stars);
        setComment(rating.comment || "");
      })
      .catch(() => {
        // A database without 010 has nothing to say here. The panel asks
        // for a rating and the server refuses it with a reason.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const submit = async () => {
    if (!stars || sending) return;

    setSending(true);
    setError("");

    try {
      const rating = await api.ratings.create({
        requestId: tripId,
        stars,
        comment,
      });

      setSaved(rating.rating ?? { stars, comment });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  // Nothing to rate without a trip to hang it on.
  if (!tripId || loading) return null;

  // --- already rated, and not being changed ---
  if (saved && !editing) {
    return (
      <section className="rate-panel rate-panel--done">
        <div>
          <span className="eyebrow">YOU RATED THIS</span>

          <Stars value={saved.stars} />

          {saved.comment && <p className="rate-panel-said">“{saved.comment}”</p>}
        </div>

        <button
          type="button"
          className="text-button"
          onClick={() => setEditing(true)}
        >
          Change
        </button>
      </section>
    );
  }

  // --- the form ---
  return (
    <section className="rate-panel">
      <span className="eyebrow">HOW WAS IT</span>

      <h3>Rate {them}</h3>

      <Stars value={stars} onPick={setStars} size="big" label={`Rate ${them}`} />

      <strong className="rate-panel-meaning">
        {stars ? MEANINGS[stars] : "Tap a star"}
      </strong>

      {/* The comment box only once there is a rating to comment on. An
          empty textarea above an untouched row of stars is a form; a
          textarea that appears when you pick four is a question. */}
      {stars > 0 && (
        <>
          <textarea
            rows={2}
            maxLength={500}
            value={comment}
            placeholder={
              isDriver
                ? "Anything to add? They see the words, not your name."
                : "Anything to add? They see the words, not your name."
            }
            onChange={(e) => setComment(e.target.value)}
          />

          {error && <p className="form-error">{error}</p>}

          <div className="rate-panel-actions">
            <button
              type="button"
              className="primary-button"
              disabled={sending}
              onClick={submit}
            >
              {sending ? "Saving…" : saved ? "Update rating" : "Save rating"}
            </button>

            {saved && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEditing(false);
                  setStars(saved.stars);
                  setComment(saved.comment || "");
                  setError("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
