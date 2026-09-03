import React, { useEffect, useRef, useState } from "react";
import { resolvePlace, searchPlaces } from "./lib/geo";
import { newSessionToken } from "./lib/session";
import MapPicker from "./MapPicker";

/**
 * Address field with type-ahead suggestions.
 *
 * Calls onChange(place) with { label, context, lat, lng } once a
 * suggestion is picked, or null while the text is still free-form —
 * so a caller can require a real, coordinate-backed place.
 */
export default function AddressInput({
  label,
  name,
  placeholder,
  value,
  onChange,
  required = false,
  mapTitle,
}) {
  const [text, setText] = useState(value?.label || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [pickingOnMap, setPickingOnMap] = useState(false);
  const [resolvingPick, setResolvingPick] = useState(false);
  const [pickError, setPickError] = useState("");

  // One act of picking a place — every keystroke of it plus the single
  // lookup at the end — shares a token, which is how Google bills
  // autocomplete as one search rather than twelve.
  const sessionRef = useRef(newSessionToken());

  const boxRef = useRef(null);
  // Tracks whether the current text came from picking a suggestion,
  // so re-renders don't reopen the dropdown.
  const pickedRef = useRef(Boolean(value));

  // Let the parent reset the field (OfferRide clears the form on submit).
  useEffect(() => {
    if (!value) {
      pickedRef.current = false;
      setText((current) => (pickedRef.current ? "" : current));
    } else if (value.label !== text) {
      pickedRef.current = true;
      setText(value.label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced lookup. The abort controller cancels the in-flight request
  // whenever another keystroke lands.
  useEffect(() => {
    if (pickedRef.current || text.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      const found = await searchPlaces(text, {
        signal: controller.signal,
        session: sessionRef.current,
      });

      if (!controller.signal.aborted) {
        setResults(found);
        setHighlight(-1);
        setOpen(true);
        setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  // Close the dropdown when focus moves elsewhere on the page.
  useEffect(() => {
    const onDocumentClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  /** A place that already has coordinates — the map picker's output. */
  const pick = (place) => {
    pickedRef.current = true;
    setText(place.label);
    setResults([]);
    setOpen(false);
    setHighlight(-1);
    setPickError("");
    onChange(place);
  };

  /**
   * A suggestion from the dropdown, which carries no coordinates yet.
   *
   * Showing the chosen text immediately keeps the field responsive while
   * the one lookup that resolves it is in flight. If that lookup fails
   * the field is left unresolved rather than silently holding a place
   * with no position — callers rely on a value meaning real coordinates.
   */
  const chooseSuggestion = async (suggestion) => {
    pickedRef.current = true;
    setText(suggestion.label);
    setResults([]);
    setOpen(false);
    setHighlight(-1);
    setPickError("");
    setResolvingPick(true);

    try {
      const full = await resolvePlace(suggestion.placeId, sessionRef.current);

      // A resolve closes the billing session; the next search opens one.
      sessionRef.current = newSessionToken();

      setText(full.label);
      onChange(full);
    } catch (err) {
      setPickError(err.message);
      onChange(null);
    } finally {
      setResolvingPick(false);
    }
  };

  const handleType = (e) => {
    pickedRef.current = false;
    setText(e.target.value);
    // The text no longer matches a resolved place.
    onChange(null);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && highlight >= 0) {
      // Don't submit the form while choosing a suggestion.
      e.preventDefault();
      chooseSuggestion(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <label className="address-input" ref={boxRef}>
      {label}

      <span className="address-field">
        <input
          name={name}
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={handleType}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          required={required}
        />

        <button
          type="button"
          className="address-map-button"
          onClick={() => {
            setOpen(false);
            setPickingOnMap(true);
          }}
          title="Pick this spot on the map"
        >
          ⌖ Map
        </button>
      </span>

      {value && (
        <span className="address-pin">
          ✓ {value.context || "located"}
        </span>
      )}

      {resolvingPick && <span className="address-hint">pinning it down…</span>}

      {pickError && <span className="address-hint address-hint--error">{pickError}</span>}

      {!value && !resolvingPick && searching && (
        <span className="address-hint">searching…</span>
      )}

      {!value && !searching && !resolvingPick && text.trim().length >= 3 && open && results.length === 0 && (
        <span className="address-hint">no matches — try a nearby landmark</span>
      )}

      {open && results.length > 0 && (
        <ul className="address-results">
          {results.map((place, i) => (
            <li key={`${place.placeId}-${i}`}>
              <button
                type="button"
                className={i === highlight ? "highlighted" : ""}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => chooseSuggestion(place)}
              >
                <strong>
                  {place.label}
                  {place.kind && <em className="place-kind">{place.kind}</em>}
                </strong>

                {place.context && <span>{place.context}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Opens on the current pick when there is one, so adjusting a spot
          by a few metres does not mean finding it on the map again. */}
      <MapPicker
        open={pickingOnMap}
        initial={value ? { lat: value.lat, lng: value.lng } : null}
        title={mapTitle || (typeof label === "string" ? `Pick "${label}"` : "Pick a location")}
        onPick={pick}
        onClose={() => setPickingOnMap(false)}
      />
    </label>
  );
}
