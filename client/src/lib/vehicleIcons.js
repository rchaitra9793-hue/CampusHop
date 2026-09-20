// The vehicles, drawn rather than typed.
//
// These used to be emoji. Emoji are a font, and a font is a thing the
// operating system chooses: 🛵 is a different picture on Android, on
// Windows and on a Mac, sits on its own coloured background that fights
// the map, and cannot be given the app's own ink outline. On a map it has
// a worse problem — the marker is rotated to the direction of travel, and
// an emoji is drawn side-on, so rotating it points a *profile* of a
// scooter north while the road runs east.
//
// So the map glyphs here are top-down, nose-up silhouettes. Rotating one
// by the compass heading puts the vehicle on the road the way an aerial
// photograph would, which is what every navigation app draws and the
// reason it reads instantly.

const INK = "#2b2622";

// One accent each, from the app's own palette, so a vehicle is
// recognisable by colour before its shape has been read.
const ACCENT = {
  car: "#ffd166",
  scooty: "#e87389",
  bike: "#8fa876",
  none: "#b4a7e5",
};

function accentFor(vehicle) {
  return ACCENT[String(vehicle || "").toLowerCase()] || ACCENT.car;
}

/**
 * The body of each glyph, as markup.
 *
 * Drawn in a 32×32 box pointing straight up, because "up" is what a
 * rotation of zero degrees means. Strokes are the app's ink at a weight
 * that survives being scaled down to marker size.
 */
const SHAPES = {
  // Wheels first, poking out past the body on both sides. They are what
  // makes a shape read as a vehicle-from-above rather than a lozenge —
  // without them a top-down car is a bar of soap.
  car: (c) => `
    <rect x="3.4" y="6.4" width="5.2" height="6.8" rx="2.2" fill="${INK}"/>
    <rect x="23.4" y="6.4" width="5.2" height="6.8" rx="2.2" fill="${INK}"/>
    <rect x="3.4" y="18.8" width="5.2" height="6.8" rx="2.2" fill="${INK}"/>
    <rect x="23.4" y="18.8" width="5.2" height="6.8" rx="2.2" fill="${INK}"/>
    <rect x="8.6" y="2" width="14.8" height="28" rx="4.8"
          fill="${c}" stroke="${INK}" stroke-width="1.8"/>
    <path d="M11 12 21 12 19.7 7 12.3 7Z" fill="${INK}"/>
    <path d="M11.4 20.4 20.6 20.4 19.5 25 12.5 25Z" fill="${INK}" opacity="0.75"/>`,

  // A scooter from above: small wheels, narrow bars, and one continuous
  // rounded body — the step-through deck is the whole silhouette.
  scooty: (c) => `
    <rect x="13.6" y="1.4" width="4.8" height="7" rx="2.2" fill="${INK}"/>
    <rect x="6" y="8.6" width="20" height="3.1" rx="1.55" fill="${INK}"/>
    <path d="M13 10.4h6l1.7 5.8v6.2a3.7 3.7 0 0 1-3.7 3.7h-2a3.7 3.7 0 0 1-3.7-3.7v-6.2Z"
          fill="${c}" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <rect x="13.2" y="16.8" width="5.6" height="5.2" rx="2.4" fill="${INK}" opacity="0.8"/>
    <rect x="13.6" y="23.6" width="4.8" height="7" rx="2.2" fill="${INK}"/>`,

  // A motorbike: taller wheels, wider bars, and a tank ahead of the seat
  // — the pinch between the two is what separates it from the scooter.
  bike: (c) => `
    <rect x="13.8" y="0.6" width="4.4" height="7.8" rx="2" fill="${INK}"/>
    <rect x="4.4" y="7.8" width="23.2" height="3" rx="1.5" fill="${INK}"/>
    <path d="M12.6 10.2h6.8l1.3 5.6-1.7 2.4h-6l-1.7-2.4Z"
          fill="${c}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13.2 18.6h5.6l1 3.9-1.5 2.1h-4.6l-1.5-2.1Z"
          fill="${INK}" opacity="0.85"/>
    <rect x="13.8" y="23.6" width="4.4" height="7.8" rx="2" fill="${INK}"/>`,

  // A person seen from above: head, then shoulders. Never rotated — a
  // walking figure spun to face east reads as someone lying down.
  none: (c) => `
    <path d="M5.8 27.5a10.2 10.2 0 0 1 20.4 0Z"
          fill="${c}" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <circle cx="16" cy="10.2" r="6" fill="${c}" stroke="${INK}" stroke-width="1.7"/>`,
};

function shapeFor(vehicle) {
  const key = String(vehicle || "").toLowerCase();
  return SHAPES[key] || SHAPES.car;
}

/**
 * A vehicle glyph as markup, for the map markers.
 *
 * Returned as a string because Google's overlays take HTML, not React —
 * these are drawn into a marker element by hand.
 */
export function vehicleIconSvg(vehicle, size = 22) {
  return (
    `<svg viewBox="0 0 32 32" width="${size}" height="${size}" ` +
    `aria-hidden="true" focusable="false">${shapeFor(vehicle)(accentFor(vehicle))}</svg>`
  );
}

/** The rider on the driver's map: a person, not a vehicle. */
export function personIconSvg(size = 22) {
  return vehicleIconSvg("none", size);
}

/**
 * The arrows laid along a route.
 *
 * Also previously a text glyph (➤), which fails the same way: if the
 * font lacks it, nothing is drawn and nothing says so.
 */
export function routeArrowSvg(size = 13) {
  return (
    `<svg viewBox="0 0 12 12" width="${size}" height="${size}" ` +
    `aria-hidden="true" focusable="false">` +
    `<path d="M6 1.2 10.4 10.6 6 8.3 1.6 10.6Z" fill="${INK}" ` +
    `stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/></svg>`
  );
}

/** The raw shape markup, for the component that renders it as an element. */
export function vehicleIconMarkup(vehicle) {
  return shapeFor(vehicle)(accentFor(vehicle));
}
