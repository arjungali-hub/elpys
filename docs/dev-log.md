# Elpys dev log

Chronological record of changes made via Claude Code, newest first. This file is
part of the repo's GitHub sync into the Elpys Claude Project, so Cowork sessions
can read it automatically. It's a supplement to `elpys-project-context.md` (which
lives in the Claude Project itself, not this repo, and is the narrative canonical
doc) — this file is the raw log a Cowork session pulls from when refreshing that
doc, not a replacement for it.

## 2026-08-25 — Clean URLs, analytics switched on, designed loading states

- **Loading states** (`10bd132`) — implemented the skeleton + button-spinner set
  Arjun designed. The authored CSS went into `styles.css` rather than staying a
  separate file, so fourteen pages pick it up without a second request;
  `loading.js` holds the markup builders so each shape is defined once.
- The design source folder (`loading animations/`) is **deliberately gitignored**.
  Everything in the repo root is served publicly by Vercel, and it's a
  design-tool export plus a 69KB `support.js` that would become live fetchable
  URLs for no benefit. Nothing in it is needed to run the site.
- **Extensionless URLs** (`f2792af`) — `cleanUrls` is on: `/about`, `/map`, and
  the homepage is the bare domain. Old `.html` paths 308-redirect, so bookmarks
  and already-sent digest emails keep working.
- The non-obvious part of that change: `safeUrl()`'s allowlist ended in
  `[\w.-]+\.html`, so extensionless internal links would have failed it and
  every homepage card and map popup would have rendered `href="#"` — a site that
  looks fine and goes nowhere. It's now written **reject-then-allow**, because
  the tempting fix ("allow bare words") would wave `javascript:alert(1)` straight
  through: `javascript` is a bare word. Non-http(s)/mailto schemes are refused
  first, then what remains is accepted as a path.
- **PostHog is live** (`f2792af`, `6538a4e`) — real project key in place. Region
  was confirmed empirically rather than trusted from a comment: the key resolves
  at `us.i.posthog.com` and 404s at `eu.i.posthog.com`.
- `capture_performance: false` was added, because the PostHog project's *remote*
  config enables web vitals and network timing. That collects per-visitor
  performance data beyond page views and the three explicit events, i.e. more
  than the privacy policy describes. The client-side config is now the stricter
  of the two, so the policy stays true regardless of project settings.
- **Gotcha worth remembering:** PostHog silently drops events from user agents it
  classifies as bots, and headless Chrome is one. `capture()` returns `null` and
  no network request appears — indistinguishable from a broken key or a bad
  config. Override the user agent when verifying analytics from a headless
  browser, or you will chase a fault that isn't there.
- Legal copy corrected while analytics went live: the privacy policy claimed
  filter usage was tracked (it isn't — only sign-up clicks, submissions and
  feedback), and the terms implied the whole site was teens-only when in fact
  only *accounts* are 13+; browsing is open to anyone.
- Open follow-ups, carried: the admin Published list still has no way to clear
  past one-time events, and the map sidebar doesn't show event dates.

## 2026-08-24 — Geocoding on edit, and the Data Review queue

- **Addresses re-geocode when an admin edits them** (`77331a0`). Changing an
  address used to leave the old coordinates, so the pin silently pointed at the
  previous location. The geocoder moved to `lib/geocode.js`, shared with
  `/api/submit` instead of duplicated.
- Two rules keep that from being annoying: it only fires when the address
  *actually changed*, and hand-edited lat/lng win over the lookup — otherwise
  dragging a pin into place would be undone the next time anything on that card
  was saved. If the lookup fails, **nothing** is saved: a new address stored
  beside old coordinates looks right in the panel and is wrong on the map.
- **Data Review** (`c95c2bf`) — URLs in flag text are links now; flags a human
  has decided moved into their own "Waiting on the automated run" section (they
  stay `pending` until the scheduled check applies the fix, so they were making
  the queue look longer than the work left in it); and the header's Data review
  link carries a red/yellow/green dot.
- **The pause warning is a proxy, and should be read as one.** Supabase counts
  *any* API request as activity, including page views, which leave no trace in
  the data. So it's driven by the newest write across the app's tables and will
  read stale on a site that's being read but not written to. It fires at 5 days
  idle of the 7-day window — one named constant, `PAUSE_WARN_AT_IDLE_DAYS` in
  `api/review.js`, if that turns out to be too eager or too late.
- Decision recorded because it wasn't obvious: "will pause in the next week"
  can't be taken literally — pausing happens at 7 days idle, so that condition is
  true from the moment the clock starts. It's implemented as "pausing is
  imminent, act now."
