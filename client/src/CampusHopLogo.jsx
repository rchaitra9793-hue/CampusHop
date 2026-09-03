import React from "react";

export default function CampusHopLogo({
  showName = true,
  showTagline = false,
  size = "normal",
}) {
  return (
    <div className={`campus-logo campus-logo--${size}`}>
      <div className="campus-logo-icon">
        <svg
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="CampusHop scooter logo"
          role="img"
        >
          {/* Flag */}
          <path
            d="M50 17V5"
            className="logo-line"
          />

          <path
            d="M50 6 C58 3 64 7 69 5 L69 16 C62 18 57 13 50 16"
            className="logo-coral-fill"
          />

          {/* Scooter mirrors */}
          <circle cx="25" cy="25" r="5" className="logo-dark-fill" />
          <circle cx="75" cy="25" r="5" className="logo-dark-fill" />

          <path
            d="M30 27 L38 35"
            className="logo-line"
          />

          <path
            d="M70 27 L62 35"
            className="logo-line"
          />

          {/* Handlebar */}
          <path
            d="M38 35 Q50 29 62 35"
            className="logo-line"
          />

          {/* Scooter body */}
          <path
            d="
              M39 34
              C30 38 28 49 31 62
              C34 75 43 84 50 88
              C57 84 66 75 69 62
              C72 49 70 38 61 34
              C55 31 45 31 39 34Z
            "
            className="logo-scooter"
          />

          {/* Headlight */}
          <circle
            cx="50"
            cy="40"
            r="9"
            className="logo-headlight"
          />

          <circle
            cx="50"
            cy="40"
            r="5"
            className="logo-headlight-inner"
          />

          {/* Heart */}
          <path
            d="
              M50 64
              C46 59 39 59 39 65
              C39 71 45 74 50 78
              C55 74 61 71 61 65
              C61 59 54 59 50 64Z
            "
            className="logo-heart"
          />

          {/* Scooter base */}
          <path
            d="M39 83 Q50 91 61 83"
            className="logo-line"
          />

          {/* Wheels */}
          <circle
            cx="38"
            cy="88"
            r="5"
            className="logo-wheel"
          />

          <circle
            cx="62"
            cy="88"
            r="5"
            className="logo-wheel"
          />
        </svg>
      </div>

      {showName && (
        <div className="campus-logo-copy">
          <div className="campus-logo-name">
            Campus<span>Hop</span>
          </div>

          {showTagline && (
            <div className="campus-logo-tagline">
              RIDE TOGETHER. GO FURTHER.
            </div>
          )}
        </div>
      )}
    </div>
  );
}