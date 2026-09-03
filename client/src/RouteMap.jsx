import React, { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, createHtmlMarker, mapId } from "./lib/maps";

/**
 * Draws stored routes on a real map.
 *
 * Accepts either a single `geometry` (a ride's saved LineString) or a
 * `routes` array for showing several at once — the rider's own route
 * against a driver's, for instance. Either way the geometry is already
 * in hand, so rendering makes no routing API calls: the lines come from
 * OpenRouteService and are drawn as our own polylines on Google's map.
 *
 * Map failures are contained here: the script can be blocked, the key can
 * be wrong, and WebGL is not available everywhere — so a broken map
 * degrades to a small notice rather than taking the page down with it.
 */
export default function RouteMap({
  geometry,
  routes,
  markers,
  pickup,
  dropoff,
  height = 320,
  interactive = true,
}) {
  const containerRef = useRef(null);
  const [failed, setFailed] = useState(null);

  // Normalise the single-route shorthand into the array form.
  const layers =
    routes ??
    (geometry ? [{ id: "route", geometry, color: "#ff8fa3", width: 4.5 }] : []);

  const pins =
    markers ??
    (geometry?.coordinates?.length
      ? [
          { lngLat: geometry.coordinates[0], kind: "pickup", label: pickup },
          {
            lngLat: geometry.coordinates[geometry.coordinates.length - 1],
            kind: "dropoff",
            label: dropoff,
          },
        ]
      : []);

  const drawable = layers.filter((l) => l.geometry?.coordinates?.length >= 2);
  const placedPins = pins.filter((p) => p.lngLat);

  // A single searched place is worth a map too — picking "From" should
  // show the spot that was just chosen, not an empty-state notice.
  const hasContent = drawable.length > 0 || placedPins.length > 0;

  // Re-running only on the actual shape of the data avoids rebuilding the
  // map on every parent render.
  const signature = JSON.stringify([
    drawable.map((l) => [l.id, l.color, l.width, l.dashed, l.geometry.coordinates.length]),
    placedPins.map((p) => [p.kind, p.label, p.lngLat]),
  ]);

  useEffect(() => {
    if (!containerRef.current || !hasContent) return;

    let cancelled = false;
    let map = null;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        const HtmlMarker = createHtmlMarker(maps);

        map = new maps.Map(containerRef.current, {
          mapId: mapId(),
          zoom: drawable.length > 0 ? 11 : 15,
          center: { lat: 0, lng: 0 },

          // A route preview is something to look at, not to fly around.
          disableDefaultUI: !interactive,
          zoomControl: interactive,
          gestureHandling: interactive ? "greedy" : "none",
          keyboardShortcuts: interactive,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });

        const bounds = new maps.LatLngBounds();

        // GeoJSON is [lng, lat]; Google is {lat, lng}. Everything below
        // crosses that boundary exactly once, here.
        const toLatLng = ([lng, lat]) => ({ lat, lng });

        drawable.forEach((layer) => {
          const path = layer.geometry.coordinates.map(toLatLng);

          path.forEach((point) => bounds.extend(point));

          // Casing underneath keeps the line legible over busy areas.
          new maps.Polyline({
            path,
            map,
            strokeColor: "#2b2622",
            strokeOpacity: 0.2,
            strokeWeight: (layer.width ?? 4.5) + 3,
            zIndex: 1,
          });

          new maps.Polyline({
            path,
            map,
            strokeColor: layer.color ?? "#ff8fa3",
            strokeOpacity: layer.dashed ? 0 : (layer.opacity ?? 1),
            strokeWeight: layer.width ?? 4.5,
            zIndex: 2,

            // A dashed line is drawn as repeated dots along the path;
            // there is no stroke-dasharray on a Google polyline.
            ...(layer.dashed
              ? {
                  icons: [
                    {
                      icon: {
                        path: "M 0,-1 0,1",
                        strokeOpacity: layer.opacity ?? 1,
                        strokeColor: layer.color ?? "#ff8fa3",
                        strokeWeight: layer.width ?? 4.5,
                        scale: 2,
                      },
                      offset: "0",
                      repeat: "14px",
                    },
                  ],
                }
              : {}),
          });
        });

        placedPins.forEach((pin) => {
          const position = toLatLng(pin.lngLat);

          bounds.extend(position);

          const marker = new HtmlMarker({
            position: new maps.LatLng(position.lat, position.lng),
            className: `map-pin map-pin--${pin.kind}`,
            map,
            zIndex: 5,
          });

          if (pin.label) {
            const info = new maps.InfoWindow({ content: pin.label });

            marker.getElement().addEventListener("click", () =>
              info.open({ map, anchor: undefined, position })
            );
          }
        });

        // fitBounds on a single point zooms to the maximum, which lands on
        // a featureless close-up. One point is a centre, not a bounds.
        if (bounds.isEmpty()) return;

        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();

        if (ne.equals(sw)) {
          map.setCenter(ne);
          map.setZoom(16);
        } else {
          map.fitBounds(bounds, 48);

          // fitBounds has no maxZoom of its own; clamp once it settles.
          maps.event.addListenerOnce(map, "idle", () => {
            if (map.getZoom() > 16) map.setZoom(16);
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setFailed(err.message);
      });

    return () => {
      cancelled = true;

      // Google has no map.remove(); dropping the container's children is
      // what releases it, and React will replace the node anyway.
      map = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, interactive, hasContent]);

  if (!hasContent) {
    return (
      <div className="route-map route-map--empty" style={{ height }}>
        <span>No mapped route for this ride yet.</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="route-map route-map--empty" style={{ height }}>
        <span>{failed}</span>
      </div>
    );
  }

  return <div className="route-map" ref={containerRef} style={{ height }} />;
}
