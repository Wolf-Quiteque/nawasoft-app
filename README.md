# NAWASOFT

A mobile-first operations PWA for NAWABUS: live seat sales by bus, tickets
search with refund/reschedule, per-trip seat maps and sales caps, and a
kill-switch to stop all sales in an emergency.

Built with Next.js 15 (App Router), Tailwind v4, Framer Motion, and the same
Supabase project as `admin-app` — it reads and writes the same `trips`,
`tickets`, `buses` and `routes` tables, so anything done here is immediately
consistent with the admin panel and the booking apps.

## Stack

- Next.js 15 App Router, JavaScript (no TypeScript, matching `admin-app`)
- Tailwind CSS v4 (`@theme inline`, OKLCH warm amber/orange palette)
- Framer Motion for sheet/list animations
- `@supabase/ssr` for cookie-based auth, service-role client for all data
  reads/writes (every write route calls `requireStaff()` first)
- Hand-rolled PWA: `public/manifest.webmanifest`, `public/sw.js` (app-shell
  cache only — `/api/*` is always network), icons generated from
  `scripts/icon-*.svg` via `npm run icons` (uses `sharp`)

## Getting started

```bash
npm install
npm run icons   # regenerate PWA icons if scripts/icon-*.svg change
npm run dev
```

Copy `.env.local` (already present, not committed) or set:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Auth & sessions

Staff sign in with the same `<phone>@nawabus.com` / password accounts as
`admin-app` (role must be `admin` or `agent`). A session lasts **7 days** on
a device: `middleware.js` enforces this via a `nawasoft_session_started`
cookie stamped at login with a 7-day `Max-Age`, independent of how long
Supabase's own refresh token would otherwise last.

## Feature map

| Screen | Route | Notes |
|---|---|---|
| Início (dashboard) | `/` | Today's buses in service, sold/capacity, tap → per-origin breakdown |
| Bus detail | `/buses/[busId]` | Passengers by origin city for today's run |
| Viagens (trips) | `/trips` | Defaults to today; date nav; tap a run → seat map + sales limit |
| Trip detail | `/trips/[tripId]` | Seat map (all legs combined — same physical bus), sales cap editor |
| Rotas (routes) | `/routes` | Grouped by province, tap → today's departures for that route |
| Bilhetes (tickets) | `/tickets` | Search by name/phone/reference/ticket number |
| Ticket detail | `/tickets/[id]` | Refund, reschedule (with/without the rebooking multa) |
| Emergência | `/emergency` | Stop/resume sales on every active bus, audited in `emergency_stops` |

## Data model notes carried over from admin-app

- A physical bus departure can be several `trips` rows (same `bus_id` +
  exact `departure_time`) when the coach picks up at more than one terminal.
  NAWASOFT always groups these into a "run" via `get_overlapping_trip_ids`
  before showing sold/capacity or a seat map — see `lib/trip-runs.js` and
  `lib/trip-run-detail.js`.
- Seat 1 is always the co-pilot seat and never sellable (`lib/seats.js`).
- The rebooking multa is 60% of the fare as of 2026-09-11
  (`lib/rebooking-fee.js`, kept in sync with `admin-app/lib/rebooking-fee.js`).
- `supabase/migrations/20260911_emergency_stops.sql` adds the audit table
  the emergency stop/resume flow reads and writes.
