import React from "react";
import { vehicleIconMarkup } from "./lib/vehicleIcons";

/**
 * A vehicle glyph as an element, for cards, lists and the profile page.
 *
 * The map markers use the string form in `vehicleIcons.js` instead —
 * Google's overlays take HTML, not React.
 */
export default function VehicleIcon({ vehicle, size = 26, className, label }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label || `${vehicle || "vehicle"} icon`}
      dangerouslySetInnerHTML={{ __html: vehicleIconMarkup(vehicle) }}
    />
  );
}
