// Loading the Google Maps JavaScript API.
//
// The script is a global singleton: two <script> tags for it in one page
// is an error, and every map component mounts independently. So the load
// is done once and every caller waits on the same promise.
//
// This key does ship in the bundle — the Maps JS API has no server-side
// mode, so there is nowhere else to put it. What protects it is the HTTP
// referrer restriction set on it in the Google Cloud console. Everything
// with real quota attached (place search, geocoding) stays on the server
// under a different key.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;

let loader = null;

export function mapsAvailable() {
  return Boolean(KEY);
}

/** The optional cloud-styled map id, if one has been configured. */
export function mapId() {
  return MAP_ID || undefined;
}

/**
 * Resolves with `google.maps` once the API is ready.
 *
 * Rejects with a message meant for a person, because a missing key or a
 * blocked script is something the person running the app can fix.
 */
export function loadGoogleMaps() {
  if (!KEY) {
    return Promise.reject(
      new Error("Maps are not configured. Add VITE_GOOGLE_MAPS_KEY to client/.env.")
    );
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const script = document.createElement("script");

    // `loading=async` is what Google asks for; `marker` is the library
    // the map components use for their own pins.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}` +
      `&libraries=marker&loading=async&v=weekly`;
    script.async = true;

    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps loaded but did not initialise."));
    };

    script.onerror = () => {
      // Reset so a later mount can try again — this is usually a network
      // blip or an ad blocker rather than a permanent failure.
      loader = null;
      reject(new Error("Could not reach Google Maps. Check the network and the API key."));
    };

    document.head.appendChild(script);
  });

  return loader;
}

/**
 * A map marker whose content is our own HTML.
 *
 * Google's AdvancedMarkerElement can do this, but only on a map created
 * with a cloud Map ID — a piece of setup this app should not require.
 * An OverlayView has no such condition and gives the same control, so
 * the pins, direction arrows and moving vehicle are all built on it.
 */
export function createHtmlMarker(maps) {
  class HtmlMarker extends maps.OverlayView {
    constructor({ position, className, html, map, zIndex = 0 }) {
      super();

      this.position = position;
      this.zIndex = zIndex;

      this.element = document.createElement("div");
      this.element.className = `gm-html-marker ${className || ""}`;
      this.element.style.position = "absolute";
      this.element.style.zIndex = String(zIndex);
      if (html) this.element.innerHTML = html;

      if (map) this.setMap(map);
    }

    onAdd() {
      // overlayMouseTarget keeps the element clickable; the other panes
      // sit below the map's own event surface.
      this.getPanes().overlayMouseTarget.appendChild(this.element);
    }

    draw() {
      const point = this.getProjection()?.fromLatLngToDivPixel(this.position);

      if (!point) return;

      // Centred on its coordinate rather than hanging off the corner.
      this.element.style.left = `${point.x}px`;
      this.element.style.top = `${point.y}px`;
      this.element.style.transform = "translate(-50%, -50%)";
    }

    onRemove() {
      this.element.remove();
    }

    setPosition(position) {
      this.position = position;
      this.draw();
    }

    getElement() {
      return this.element;
    }
  }

  return HtmlMarker;
}
