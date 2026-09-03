import React from "react";

export default function RouteIllustration({
  compact = false,
  pickup = "BTM Layout",
  dropoff = "Campus",
}) {
  return (
    <div className={`route-sketch ${compact ? "route-sketch--compact" : ""}`}>
      <svg
        className="route-svg"
        viewBox="0 0 500 130"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M18 92 C80 25, 115 105, 175 63 S270 20, 320 70 S405 112, 480 34"
          className="route-path"
        />

        <circle cx="18" cy="92" r="7" className="route-point route-point--start" />
        <circle cx="480" cy="34" r="7" className="route-point route-point--end" />

        <path
          d="M95 55 l10 -7 M195 48 l10 6 M305 64 l-7 9 M390 76 l9 -7"
          className="route-doodle"
        />
      </svg>

      <div className="route-label route-label--start">
        <span>pickup</span>
        <strong>{pickup}</strong>
      </div>

      <div className="route-label route-label--end">
        <span>drop-off</span>
        <strong>{dropoff}</strong>
      </div>
    </div>
  );
}