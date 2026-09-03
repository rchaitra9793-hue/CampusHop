# CampusHop

A ride-sharing app for a single college campus. Students and faculty post
their commutes; other members of the same campus find rides that actually
pass their way.

## Architecture

Three tiers. The browser never touches the database.

```
  React client  ──HTTP──▶  Express API  ──▶  Supabase (Postgres)
  (client/)                (server/)         database only
       │                        │
       │                        ├──▶  OpenRouteService   road routing
       │                        └──▶  Google Maps        places + geocoding
       │
       └──▶  Google Maps JavaScript API   drawing the map itself
```

**Why routing is not on Google.** The matcher scores the whole ride board
against route geometry stored on each row, which is what makes searching
cost nothing — and Google's terms do not allow route responses to be kept
that way. OpenRouteService does, so routes stay there and are drawn as our
own polylines on Google's map. Google does the two jobs it is genuinely
better at: finding an Indian address from three letters, and naming a
dropped pin.

**Two Google keys, on purpose.** Place search and geocoding run on the
server under a key the browser never sees. Only the Maps JavaScript API
needs a key in the page — it has no server-side mode — and that one is
restricted by HTTP referrer and can do nothing but draw maps.

**Why the API server exists.** Ownership and safety rules have to be
enforced somewhere the user cannot edit. The server decides who you are
from a signed token, so the browser cannot claim to be another driver,
forge a route, oversell a vehicle, or answer someone else's requests.
It also holds the routing API key, which would otherwise ship inside the
public JavaScript bundle.

**Authentication** is Supabase Auth, called from the client at sign-in
only. It returns an access token, which the client sends on every API
request; the server verifies it before handling anything. This is the
usual pattern for an app built on a hosted auth provider.

## Running it

Two processes. Both must be running.

```bash
# terminal 1 — API
cd server
npm install
npm run dev          # http://localhost:5000

# terminal 2 — web app
cd client
npm install
npm run dev          # http://localhost:5173
```

Then open http://localhost:5173.

### Configuration

`server/.env`

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 5000) |
| `CLIENT_ORIGIN` | Allowed CORS origin |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Used to verify user tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses row-level security. **Set this.** |
| `ORS_API_KEY` | OpenRouteService key — never sent to the browser |
| `GOOGLE_MAPS_KEY` | Places + Geocoding. Server-side only |
| `CITY_LAT`, `CITY_LON` | Where to bias address search (default Bengaluru) |

`client/.env`

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Sign-in only |
| `VITE_SUPABASE_ANON_KEY` | Sign-in only |
| `VITE_API_URL` | Where the API server lives |
| `VITE_GOOGLE_MAPS_KEY` | Maps JavaScript API. Ships in the bundle — restrict it by HTTP referrer |
| `VITE_GOOGLE_MAP_ID` | Optional. Only for cloud map styling |

### Database

Run each file in `db/` once, in order, in the Supabase SQL editor:

| File | What it adds |
| --- | --- |
| `001_add_route_columns.sql` | Coordinates and stored route geometry on rides |
| `002_one_request_per_rider.sql` | Unique index making a double request impossible |
| `003_vehicle_number.sql` | The number plate a rider looks for at the kerb |

`db/backfill-routes.mjs` fills in routes for any rides created before
coordinates were stored. It is a dry run unless given `--apply`.

## API

Everything except `/api/health` requires `Authorization: Bearer <token>`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Liveness and configuration |
| GET | `/api/profile` | The caller, resolved from their token |
| POST | `/api/profile` | Create the profile row after sign-up |
| PATCH | `/api/profile` | Update your own profile only |
| GET | `/api/rides` | Search. Ranks and filters server-side |
| GET | `/api/rides/:id` | One ride |
| POST | `/api/rides` | Post a ride; the server computes the route |
| DELETE | `/api/rides/:id` | Driver only |
| GET | `/api/requests/mine` | Trips you have requested |
| GET | `/api/requests/incoming` | Requests on rides you drive |
| POST | `/api/requests` | Ask for a seat |
| PATCH | `/api/requests/:id` | Accept or decline — driver only |
| GET | `/api/geo/search?q=` | Address autocomplete. Suggestions only — no coordinates |
| GET | `/api/geo/resolve?placeId=` | Coordinates for the one suggestion picked |
| GET | `/api/geo/reverse?lat=&lng=` | Coordinates to a place name |
| POST | `/api/geo/route` | Road route between two points |

### `GET /api/rides` parameters

| Parameter | Meaning |
| --- | --- |
| `fromLat`, `fromLng`, `toLat`, `toLng` | Where the rider wants to go |
| `arriveBy` | `HH:MM` |
| `vehicle` | `car`, `bike`, `scooty` |
| `lat`, `lng` | The rider's current position |
| `radius` | Catchment in metres (default 2000) |
| `nearbyOnly` | `true` hides rides outside the radius |

## How matching works

Scoring runs on the server (`server/src/match.js`) over route geometry
already stored on each ride, so ranking the whole board costs no external
API calls.

| Weight | Component | Measured as |
| --- | --- | --- |
| 35% | Route | Dropoff distance to the driver's road line, plus a direction-of-travel check |
| 25% | Time | Ride's arrival (departure + real duration) vs the rider's arrive-by |
| 20% | Pickup | How far the rider walks to meet the route |
| 15% | Reliability | Count of that driver's accepted rides |
| 5% | Vehicle | Preference match |

Components with nothing to compare against are dropped and the remaining
weights renormalised, so a partial search still ranks meaningfully.

Distances are measured to the nearest point on the driver's **route**,
not to their starting pin — a driver who sets off far away but passes
your street can still pick you up.

## Cost

OpenRouteService is free at 2,000 requests/day, and routes are computed
once when a ride is posted and then stored — so browsing and searching the
board costs nothing at all. The matcher never calls anything.

Google is metered, and three things keep the volume down:

- **Autocomplete is session-billed.** Every keystroke of one search shares
  a session token with the single lookup that resolves it, so typing
  twelve characters costs one search rather than twelve.
- **Suggestions carry no coordinates.** Only the place actually chosen is
  resolved.
- **Pin-naming is cached** at ~11 m resolution, so panning the map picker
  re-asks the same question at most once.

Set a budget alert in the Google Cloud console regardless.
