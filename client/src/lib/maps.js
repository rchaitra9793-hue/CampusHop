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

// The libraries the map components actually build on. "maps" carries
// OverlayView, which every pin on this app extends. Only used on the
// fallback path below, for loaders that hand libraries out individually.
const LIBRARIES = ["maps", "marker"];

// Global by necessity — Google calls it by name from its own script. Stable
// rather than unique per load, so a hot reload can reassign it and have the
// request already in flight resolve the new promise.
const CALLBACK = "__campushopMapsReady";

/**
 * Whether the API is genuinely usable, as opposed to merely present.
 *
 * `window.google.maps` appears the instant the bootstrap script runs, but
 * with `loading=async` the classes arrive afterwards, library by library.
 * Checking the namespace alone is what lets a map mount against a
 * half-loaded API — and `class extends undefined` is the error you get.
 */
function ready(maps) {
  return Boolean(maps?.OverlayView);
}

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

  if (ready(window.google?.maps)) {
    return Promise.resolve(window.google.maps);
  }

  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const fail = (message) => {
      // Reset so a later mount can try again — a failure here is usually a
      // network blip or an ad blocker rather than anything permanent.
      loader = null;
      reject(new Error(message));
    };

    // Google invokes this once the API and the libraries named in the URL
    // are really loaded, and it is the only completion signal this loader
    // offers. `script.onload` is not one: the script it serves is a
    // bootstrap that creates an empty `google.maps` and *then* fetches the
    // files the classes live in. Resolving on load hands callers a
    // namespace with no OverlayView on it, which fails as the thoroughly
    // unhelpful "Class extends value undefined".
    window[CALLBACK] = async () => {
      const maps = window.google?.maps;

      // Newer loaders hand libraries out here instead of hanging them off
      // the namespace. Harmless when the callback has already done it.
      if (!ready(maps) && maps?.importLibrary) {
        try {
          await Promise.all(LIBRARIES.map((name) => maps.importLibrary(name)));
        } catch {
          // Checked below, where there is one message for every way this
          // can end up short of a usable API.
        }
      }

      if (!ready(window.google?.maps)) {
        fail("Google Maps loaded but did not initialise.");
        return;
      }

      resolve(window.google.maps);
    };

    // A key the console will not accept for this address does not fail the
    // request: the script arrives, and then quietly refuses to work. Say
    // which of the two things is actually wrong.
    if (!window.gm_authFailure) {
      window.gm_authFailure = () =>
        fail(
          "Google Maps rejected the API key for this address. Add this origin " +
            "to the key's HTTP referrer restrictions in the Google Cloud console."
        );
    }

    // A dev-server hot reload re-runs this module and loses `loader`, while
    // the script tag it added is still in the page. A second tag is an
    // error the API reports to the console and nowhere else, so adopt the
    // load already in flight — the callback reassigned just above is the
    // one Google will call.
    if (document.querySelector("script[data-campushop-maps]")) return;

    const script = document.createElement("script");

    // `loading=async` is what Google asks for, and `callback` is what it
    // asks for alongside it; `marker` is the library the map components
    // use for their own pins.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}` +
      `&libraries=marker&loading=async&v=weekly&callback=${CALLBACK}`;
    script.async = true;
    script.dataset.campushopMaps = "true";

    script.onerror = () => {
      script.remove();
      fail("Could not reach Google Maps. Check the network and the API key.");
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
  // Extending an undefined base class throws "Class extends value
  // undefined", which says nothing about maps at all. Say what is wrong.
  if (!ready(maps)) {
    throw new Error("Google Maps is not ready yet — its map library has not loaded.");
  }

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
