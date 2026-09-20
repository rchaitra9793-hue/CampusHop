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
| `CAMPUS_TIMEZONE` | The campus's own clock, which decides when a ride has departed (default `Asia/Kolkata`) |
| `RIDE_GRACE_MINUTES` | How long a departed ride nobody joined is kept before deletion (default 180) |
| `RIDE_SWEEP_MINUTES` | How often to sweep (default 15) |
| `TRIP_HISTORY_DAYS` | How long a finished trip stays in History before deletion (default 7) |

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
| `004_phone_number.sql` | A number each side can reach the other on |
| `005_live_tracking.sql` | The driver's live position, and how far along the trip is |
| `006_profile_email.sql` | The address trip mail is sent to |
| `007_messages_and_reports.sql` | In-app messages on a trip, and reporting one that went wrong |
| `008_ride_expiry.sql` | The departure as a real instant, and the sweep that clears out rides that are over |

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
| GET | `/api/rides` | Search. Ranks and filters server-side; rides that have departed are never returned |
| GET | `/api/rides/:id` | One ride |
| POST | `/api/rides` | Post a ride; the server computes the route |
| DELETE | `/api/rides/:id` | Driver only |
| GET | `/api/requests/mine` | Trips you have requested |
| GET | `/api/requests/incoming` | Requests on rides you drive |
| POST | `/api/requests` | Ask for a seat |
| PATCH | `/api/requests/:id` | Accept or decline — driver only |
| POST | `/api/rides/:id/location` | The driver's position as they move. Driver only |
| POST | `/api/rides/:id/trip` | Move the trip along. Driver only |
| GET | `/api/rides/:id/live` | Where the driver is now. Driver and accepted riders only |
| GET | `/api/requests/:id/messages` | The thread on one trip. Reading it marks it read |
| POST | `/api/requests/:id/messages` | Send a message. Sender comes from the token |
| GET | `/api/requests/unread` | Unread counts per trip, for the badge |
| POST | `/api/reports` | Report a trip. Either side; the server decides who it is about |
| GET | `/api/reports/mine` | Reports you have filed, and where each one got to |
| GET | `/api/reports/for/:requestId` | What you have already filed about one trip |
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
| `lat`, `lng` | The rider's current position. Orders the board by how close each ride passes — it never hides one |

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

## Following a trip

An accepted ride opens the live map for both people, and it runs in two
legs — because they are not the same journey.

**To the pickup.** The stored route starts where the *ride* starts, not
where the driver happens to be when they set off, so the first leg is
computed live from the driver's own position. Both sides watch it: the
driver routes from their GPS, the rider from the driver's last reported
position, so a rider at a kerb sees the street the car is actually coming
down and how long it has left — not a dot drifting across a field. The
ride's own route is on the map throughout, but faint; a bold line straight
through the pickup point is exactly what hides the leg that matters.

**Then the ride.** The driver moves the trip along by hand — arrived, then
started, then finished — and only the step that is due is offered. Arrival
is confirmed rather than inferred: GPS calls a car "at the kerb" a good
minute before it has stopped at one, and nothing but the driver knows
whether anyone actually got in. Starting the ride swaps the live leg over
to the dropoff, brings the stored route up to full strength, and gives both
sides the same distance and ETA counting down to the end of the trip.

Positions are written on a distance-or-time cadence rather than every GPS
tick, and the leg is only re-routed once the vehicle has genuinely moved on
— a trip costs a handful of routing calls, not one per fix. A fix too old
to trust is shown greyed rather than hidden: a marker frozen in the wrong
street with no explanation is worse than one openly marked as stale.

## When a ride is over

A ride is on the board until the moment it departs, and not one minute
longer. Before this, nothing in the system knew when a ride had ended —
the board was every row in the table, so a commute posted for last
Tuesday sat on "closest first" forever and could still be requested.

The reason it was awkward to fix is that a departure was only ever stored
as the two halves a person types: a `date` and a `time`, in the driver's
own wall clock. Neither can be compared against `now()`, neither can be
indexed as a moment in time, and every layer that tried got its own
chance to answer differently. So the departure is now stored as a real
instant, `departs_at`, filled in by a database trigger from whatever date
and time end up on the row — derived, never supplied, so it cannot
disagree with what the driver picked.

Turning a wall clock into an instant needs a timezone, and a single
campus is the rare case where one fixed answer is honest. It is set in
two places that must agree: `campushop_timezone()` in the migration and
`CAMPUS_TIMEZONE` in the server's environment.

Three layers apply the same rule, and none of them is only cosmetic:

| Layer | What it does |
| --- | --- |
| Database | `departs_at`, indexed; the `active_rides` view; `delete_expired_rides()` |
| API | Filters `GET /api/rides` in the query, refuses a seat on a departed ride, refuses to post one into the past |
| Browser | Drops a ride from the board the moment it departs, without waiting for a poll |

The browser's pass is the one that looks redundant and is not. A board
fetched at 07:59 still holds the 08:00 ride at 08:01, and a tab can sit
open across the whole of it — so the Find page re-checks itself against
the clock every thirty seconds rather than trusting a list that was true
when it arrived.

**Off the board and deleted are different things.** A ride leaves the
board at its departure time, whatever state it is in. It is only actually
deleted when it left more than the grace period ago and nobody ever asked
for a seat on it — posted, ignored, and now over, which is the
overwhelming majority of what piles up.

How far along the trip got is deliberately not part of that. Protecting a
trip in progress is the grace period's job; hours after departure, a ride
nobody ever requested has no passenger left to protect, and making it a
condition only kept every ride whose driver once pressed "start".

One request is enough to keep a ride forever, whatever became of it. An
accepted one is a trip somebody took, which MyTrips lists, a safety
report can point at, and the driver's reliability count is built from. A
declined one is still the rider's record of having asked. An unanswered
one is what the driver's queue shows as missed. All of them read the ride
row for where the trip was going, so deleting it would not tidy the table
— it would blank out screens that are still in use.

The sweep runs in the database on `pg_cron` where it is enabled, and from
the API server on boot and every fifteen minutes regardless. On boot
because the interesting case is a server that was off overnight, by which
time everything posted for yesterday is over.

### Getting back to it

The live map is not a screen you visit once. A driver closes it at a red
light, a rider closes it to check the address they were sent, and both of
them need it back immediately — so a trip that is actually under way is
reachable in one tap from wherever each side lives.

For the rider that is My Trips, which puts the running trip above the
tabs and above every other card, because a journey happening now outranks
one next Tuesday. For the driver it is the request queue, where an
accepted request carries the way back into the same map. Neither had one
before: accepting a request opened the map once, and closing it was the
end of the matter.

My Trips is ordered by what the rider has to do next — live first, then
soonest, then the past — and that order is decided by the API, alongside
the state each trip is in, so the two halves cannot disagree about which
trip matters. A finished trip leaves Upcoming on its own and lands in
History, where it stays for a week before it is deleted.

The week is what "Report a problem" runs on. Most trouble is only obvious
once a trip is over and the map has been closed, so the rider who gets
home and realises something was wrong still has the trip to point at.
Deleting it the moment the driver marks it complete would hand exactly
that person an empty screen. Set `TRIP_HISTORY_DAYS` to change it.

A ride the driver withdraws takes its requests with it, rather than
leaving riders holding a seat on a journey with no route, no time and
nobody driving it.

## What a seat costs

The driver does not set the price, and there is no column to store one in.
A fare is derived, every time it is asked for, from the route the server
measured when the ride was posted — so a ride cannot carry a number its
driver chose, because there is nowhere for that number to live.

That is the whole point of doing it this way. A driver who can name their
own price can undercut, overcharge, or quietly turn a campus lift into a
business, and a rider comparing two rides down the same road has to work
out which of them is being reasonable. Derived, every ride of the same
length in the same class of vehicle costs the same, and the number on the
board cannot be argued with by either side.

| Class | Vehicles | Per km | Minimum |
| --- | --- | --- | --- |
| Two-wheeler | bike, scooty | ₹2.00 | ₹10 |
| Car | car | ₹3.50 | ₹15 |

Rounded to the nearest ₹5, so it can be settled in cash without anyone
hunting for change. A bike and a scooty are deliberately one class: they
cost the same to run and carry the same one pillion, and splitting them
would only invite a driver to relabel their vehicle for a better rate. An
unrecognised or missing vehicle takes the cheaper class — a guess that
overcharges is worse than one that does not.

It is a **contribution to running costs, not a fare**. The rates are
roughly half a two-wheeler's running cost and a third of a car's — the
split you would reach if the people in the vehicle divided the cost between
them — and they sit well under what an auto or a bike taxi charges for the
same distance. The driver was making this trip anyway; the rider is sharing
the cost of a journey that was already happening, not buying a service.
Pricing it like a taxi would change what this app is, both to the people
using it and to anyone asking whether it needs a permit.

The minimums are deliberately low. Trips on this board run 2–8 km, and a
floor set much higher would bind on most of them — at which point the
per-km rate is decoration and every short ride silently costs the same. As
it stands it binds on about a third, which is the short-hop case it exists
for. The working is in `server/src/pricing.js`, and every screen that shows
a price also shows the rate behind it.

A ride posted before routes were stored has no measured length and so no
fare. Those show a dash rather than an invented number.

## Messages and reports

**Messages** belong to an accepted request, which is to say to exactly two
people: the driver of that ride and the one rider they took on. There is
nothing to read before the seat is accepted — a thread on a pending request
would be a way to pester a driver who has not agreed to anything — and
nobody else can read or write one at any point. "I'm at the second gate,
not the first" is the most common thing either of them needs to say, and
until now saying it meant handing over a personal number and leaving the
app. The thread is polled, like everything else here that changes
underneath you; a websocket for one screen would be a second way of doing
the same thing.

**Reports** can be filed by either side. A rider left standing at a kerb
and a driver who waited for someone that never came are the same failure
seen from two ends, and an app where only one of them can say so is telling
the other that what happened to them does not count. The form never asks
who the report is about: there are two people on a trip and the server
knows which one is filing, so naming the other would only be a way to get
it wrong, or to abuse it. Reports are reachable from the live screen during
a trip and from the trip lists afterwards, which is when most problems
actually become obvious.

A report outlives what it refers to. The ride and the request are set to
null if they are deleted rather than cascading the report away — a report
about a trip that has since been cleaned up is exactly the one still worth
having. There is no screen for whoever reviews them yet; the migration ends
with the query that lists them.

## Cost

OpenRouteService is free at 2,000 requests/day, and routes are computed
once when a ride is posted and then stored — so browsing and searching the
board costs nothing at all. The matcher never calls anything.

A trip being followed live is the one thing that does call it repeatedly,
since the road from wherever the vehicle *is* cannot be worked out in
advance. Two things keep that to a handful of calls rather than one per
GPS fix: the leg is only re-routed once the vehicle has genuinely moved on
from where the last one was drawn, and the rider — who is watching a
marker that already moves by itself — re-routes a good deal more lazily
than the driver, who is navigating from the line.

Google is metered, and three things keep the volume down:

- **Autocomplete is session-billed.** Every keystroke of one search shares
  a session token with the single lookup that resolves it, so typing
  twelve characters costs one search rather than twelve.
- **Suggestions carry no coordinates.** Only the place actually chosen is
  resolved.
- **Pin-naming is cached** at ~11 m resolution, so panning the map picker
  re-asks the same question at most once.

Set a budget alert in the Google Cloud console regardless.
