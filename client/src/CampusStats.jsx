import React from "react";

/** 12345 -> "12,345"; 1234567 -> "12.3L" (Indian lakh), for big headline numbers. */
export function bigNumber(n) {
  const value = Math.round(Number(n) || 0);
  if (value >= 100000) return `${(value / 100000).toFixed(value >= 1000000 ? 0 : 1)}L`;
  return value.toLocaleString("en-IN");
}

/**
 * The campus-wide numbers — km travelled together, rides completed,
 * riders carried, happy ratings. The "proof it works" strip.
 */
export default function CampusStats({ stats }) {
  if (!stats) return null;

  const items = [
    { value: `${bigNumber(stats.kmTravelled)}`, unit: "km", label: "travelled together" },
    { value: bigNumber(stats.ridesCompleted), label: "rides completed" },
    { value: bigNumber(stats.ridersCarried), label: "happy riders carried" },
    stats.averageRating != null
      ? { value: `★ ${stats.averageRating}`, label: `average from ${bigNumber(stats.happyRatings)} happy ratings` }
      : { value: bigNumber(stats.members), label: "campus members" },
  ];

  return (
    <section className="campus-stats" aria-label="CampusHop in numbers">
      <span className="eyebrow">CAMPUSHOP IN NUMBERS</span>
      <div className="campus-stats-grid">
        {items.map((item) => (
          <div key={item.label}>
            <strong>
              {item.value}
              {item.unit && <em>{item.unit}</em>}
            </strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      {!stats.available && (
        <small className="campus-stats-note">Totals start counting once the database update (014) is run.</small>
      )}
    </section>
  );
}
