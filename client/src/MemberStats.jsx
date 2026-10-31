import React from "react";

/**
 * A member's track record — rides given, rides taken, km shared and rating —
 * so the two people deciding whether to ride together can see who the
 * other one is. `compact` is one line for cards; the full version is a row
 * of figures for the request and accept boxes.
 */
export default function MemberStats({ stats, compact = false, label }) {
  if (!stats) return null;

  const rating = stats.rating != null ? `★ ${Number(stats.rating).toFixed(1)}` : "New";
  const ratingNote = stats.rating != null ? `${stats.ratingCount} rating${stats.ratingCount === 1 ? "" : "s"}` : "not rated yet";
  const since = stats.memberSince
    ? new Date(stats.memberSince).toLocaleDateString([], { month: "short", year: "numeric" })
    : null;

  if (compact) {
    return (
      <div className="member-stats member-stats--compact" title={since ? `Member since ${since}` : undefined}>
        <span>{rating}</span>
        <span>{stats.ridesGiven} given</span>
        <span>{stats.ridesTaken} taken</span>
        {stats.kmShared > 0 && <span>{Math.round(stats.kmShared)} km</span>}
      </div>
    );
  }

  return (
    <div className="member-stats">
      {label && <span className="member-stats-label">{label}</span>}
      <div className="member-stats-grid">
        <div>
          <b>{rating}</b>
          <small>{ratingNote}</small>
        </div>
        <div>
          <b>{stats.ridesGiven}</b>
          <small>rides given</small>
        </div>
        <div>
          <b>{stats.ridesTaken}</b>
          <small>rides taken</small>
        </div>
        <div>
          <b>{Math.round(stats.kmShared || 0)}</b>
          <small>km shared</small>
        </div>
      </div>
      {since && <small className="member-stats-since">Member since {since}</small>}
    </div>
  );
}
