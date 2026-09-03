import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadGoogleMaps, mapId } from "./lib/maps";
import { getCurrentLocation, reverseGeocode, resolvePlace, searchPlaces } from "./lib/geo";
import { newSessionToken } from "./lib/session";

// Where the map opens when we have nothing better to go on.
const FALLBACK = { lat: 12.9716, lng: 77.5946 };

// Close enough to a building entrance to be a useful pickup point.
const PRECISE_ZOOM = 17;

/**
 * Drop a pin to choose a place.
 *
 * The search box gets you to the right street; the pin gets you to the
 * right gate. Typing can only ever return somewhere Google has already
 * named, which is no help for "the side entrance by the canteen" — so the
 * coordinates here come from where the pin actually sits, and the name is
 * only a label for it.
 *
 * The pin is fixed at the centre of the frame and the map moves beneath
 * it. That keeps the target under the crosshair rather than under a
 * finger, and means there is no marker to lose off-screen.
 */
export default function MapPicker({ open, initial, title = "Pick a location", onPick, onClose }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  const [center, setCenter] = useState(initial || FALLBACK);
  const [place, setPlace] = useState(null);
  const [resolving, setResolving] = useState(false);

  // Two different failures. `failed` means there is no map at all; a
  // refused location request is a passing notice and must not take the
  // map down with it.
  const [failed, setFailed] = useState(null);
  const [notice, setNotice] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  // Groups this picker's keystrokes and the one lookup that follows into
  // a single billed act of searching.
  const sessionRef = useRef(newSessionToken());

  // --- the map ----------------------------------------------------------

  useEffect(() => {
    if (!open || !containerRef.current) return;

    const start = initial || FALLBACK;

    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        const map = new maps.Map(containerRef.current, {
          mapId: mapId(),
          center: start,
          zoom: initial ? PRECISE_ZOOM : 12,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,

          // The pin is what is being placed; Google's own POI pins are
          // just something else to hit by mistake.
          clickableIcons: false,
        });

        mapRef.current = map;
        setFailed(null);

        // Tapping somewhere is the obvious gesture even with a centre pin,
        // so treat it as "put the pin there" rather than ignoring it.
        map.addListener("click", (e) => map.panTo(e.latLng));

        map.addListener("idle", () => {
          const c = map.getCenter();
          setCenter({ lat: c.lat(), lng: c.lng() });
        });
      })
      .catch((err) => {
        if (!cancelled) setFailed(err.message);
      });

    return () => {
      cancelled = true;
      mapRef.current = null;
    };
    // Re-creating the map on every `initial` change would fight the user's
    // panning; it is only ever the starting position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset to the caller's starting point each time the picker opens.
  useEffect(() => {
    if (!open) return;

    setCenter(initial || FALLBACK);
    setPlace(null);
    setQuery("");
    setResults([]);
    setNotice("");
    sessionRef.current = newSessionToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // --- naming whatever is under the pin ---------------------------------

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setResolving(true);

    // Debounced: panning fires a stream of positions and only the one the
    // user settles on is worth a lookup.
    const timer = setTimeout(async () => {
      const found = await reverseGeocode(center.lat, center.lng);

      if (cancelled) return;

      // The server names the nearest known thing and says how far off it
      // is, so a pin between buildings still reads as somewhere. Only a
      // genuinely blank result falls back to bare coordinates.
      setPlace(
        found || {
          label: "Dropped pin",
          context: `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`,
          lat: center.lat,
          lng: center.lng,
        }
      );

      setResolving(false);
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [center, open]);

  // --- search inside the picker -----------------------------------------

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      const found = await searchPlaces(query, {
        signal: controller.signal,
        session: sessionRef.current,
      });

      if (!controller.signal.aborted) {
        setResults(found);
        setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const flyTo = (lat, lng, zoom = PRECISE_ZOOM) => {
    setResults([]);
    setQuery("");

    if (mapRef.current) {
      mapRef.current.panTo({ lat, lng });
      mapRef.current.setZoom(zoom);
    } else {
      // No map (script blocked) — the picker still works, just without one.
      setCenter({ lat, lng });
    }
  };

  /** A suggestion carries no coordinates until it is chosen. */
  const goToSuggestion = async (suggestion) => {
    setSearching(true);

    try {
      const full = await resolvePlace(suggestion.placeId, sessionRef.current);

      // A resolve closes the billing session; the next search starts one.
      sessionRef.current = newSessionToken();

      flyTo(full.lat, full.lng);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    setNotice("");

    try {
      const position = await getCurrentLocation();
      flyTo(position.lat, position.lng, 16);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLocating(false);
    }
  };

  // Escape closes, as it does for every other modal on the page.
  useEffect(() => {
    if (!open) return;

    const onKey = (e) => e.key === "Escape" && onClose();

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirm = () => {
    // Always the pin's own coordinates. The reverse geocode names the
    // nearest known thing, which may be metres away — taking its position
    // instead would quietly move the pin the user just placed.
    onPick({
      label: place?.label || "Dropped pin",
      context: place?.context || "",
      lat: center.lat,
      lng: center.lng,
    });

    onClose();
  };

  // Rendered at the body, not where it was declared. AddressInput's root
  // is a <label>, and a label steals clicks for its own control — nested
  // here, the picker's search box could never be typed into.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="map-picker" onClick={(e) => e.stopPropagation()}>
        <div className="map-picker-head">
          <div>
            <span className="eyebrow">DROP A PIN</span>
            <h2>{title}</h2>
          </div>

          <button type="button" className="map-picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="map-picker-search">
          <input
            type="text"
            autoComplete="off"
            placeholder="Jump to a place…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <button
            type="button"
            className="secondary-button"
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? "Locating…" : "◎ My location"}
          </button>

          {results.length > 0 && (
            <ul className="address-results">
              {results.map((r, i) => (
                <li key={`${r.placeId}-${i}`}>
                  <button type="button" onClick={() => goToSuggestion(r)}>
                    <strong>
                      {r.label}
                      {r.kind && <em className="place-kind">{r.kind}</em>}
                    </strong>
                    {r.context && <span>{r.context}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searching && results.length === 0 && (
            <span className="address-hint">searching…</span>
          )}

          {notice && <span className="address-hint">{notice}</span>}
        </div>

        <div className="map-picker-canvas">
          {failed ? (
            <div className="route-map route-map--empty">
              <span>{failed}</span>
            </div>
          ) : (
            <>
              <div className="map-picker-map" ref={containerRef} />

              {/* Fixed to the frame, not to the map — this is the pin. */}
              <div className="map-picker-crosshair" aria-hidden="true">
                <div className="map-picker-pin" />
                <div className="map-picker-shadow" />
              </div>
            </>
          )}
        </div>

        <div className="map-picker-readout">
          <div>
            <small>SELECTED</small>
            <strong>{resolving ? "Finding this spot…" : place?.label || "Dropped pin"}</strong>
            <span>
              {place?.context ? `${place.context} · ` : ""}
              {place?.approximate && place.metresAway != null
                ? `${place.metresAway} m off · `
                : ""}
              {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>

            <button type="button" className="primary-button" onClick={confirm}>
              Use this spot →
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
