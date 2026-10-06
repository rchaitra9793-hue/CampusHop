import React from "react";

/**
 * A rating, shown.
 *
 * Two jobs in one component, because they have to look like the same
 * thing: the read-only average on a ride card, and the five buttons in the
 * rating form. Passing `onPick` is what turns one into the other.
 *
 * A driver nobody has rated gets no stars at all rather than five empty
 * ones. Five empty stars reads as nought out of five, which is a verdict,
 * and the whole point is that there is not one yet.
 */
export default function Stars({
  value = 0,
  count = null,
  onPick = null,
  size = "normal",
  label = null,
}) {
  const interactive = typeof onPick === "function";

  if (!interactive && !value) {
    return <span className="stars stars--none">Not rated yet</span>;
  }

  // The average is a decimal, so a star can be part full. The read-only
  // version fills by width; the clickable one is always whole stars.
  const filled = interactive ? Math.round(value) : value;

  const stars = [1, 2, 3, 4, 5].map((n) => {
    // How much of this star is covered, 0 to 1.
    const portion = Math.max(0, Math.min(1, filled - (n - 1)));

    if (!interactive) {
      return (
        <span className="star" key={n} aria-hidden="true">
          <span className="star-empty">★</span>
          <span className="star-fill" style={{ width: `${portion * 100}%` }}>
            ★
          </span>
        </span>
      );
    }

    return (
      <button
        type="button"
        key={n}
        className={`star star--pick ${portion > 0 ? "is-on" : ""}`}
        onClick={() => onPick(n)}
        aria-label={`${n} star${n === 1 ? "" : "s"}`}
        aria-pressed={portion > 0}
      >
        ★
      </button>
    );
  });

  return (
    <span
      className={`stars stars--${size} ${interactive ? "stars--pick" : ""}`}
      role={interactive ? "group" : "img"}
      aria-label={
        interactive
          ? label || "Pick a rating"
          : `${value} out of 5${count ? ` from ${count} ${count === 1 ? "person" : "people"}` : ""}`
      }
    >
      {stars}

      {!interactive && (
        <span className="stars-value">
          {/* 4 rather than 4.00, 4.5 rather than 4.50. */}
          {Number(value).toFixed(1).replace(/\.0$/, "")}
          {count ? <small>({count})</small> : null}
        </span>
      )}
    </span>
  );
}
