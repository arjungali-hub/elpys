# Elpys dev log

Chronological record of changes made via Claude Code, newest first. This file is
part of the repo's GitHub sync into the Elpys Claude Project, so Cowork sessions
can read it automatically. It's a supplement to `elpys-project-context.md` (which
lives in the Claude Project itself, not this repo, and is the narrative canonical
doc) — this file is the raw log a Cowork session pulls from when refreshing that
doc, not a replacement for it.

## 2026-08-27 — Corrected loading skeletons, and one that was never visible

- Second pass on the designed loading states, from an updated
  `loading animations/` drop. The new CSS is a superset of the old, adding two
  extensions, and it corrects a shape I had got wrong.
- **`admin.html` and `review.html` were using a table skeleton for pages that
  render stacked cards.** Both are "header → body → footer actions" cards, not
  tables. They now use `.skel-stack` / `.skel-stackcard`: pending submissions
  get the slug/lat/lng input row and a 200px map stand-in, published cards get
  the shorter two-button shell, feedback gets compact rows. `Loading.table` is
  kept for any genuinely tabular view added later.
- **`account.html`'s skeleton invented a field that does not exist.** The old
  generic form skeleton opened with a label + text input; the account page has
  no free-text field at all (verified — zero text/email inputs). It now mirrors
  the real four blocks, including the 7×3 availability grid on the same
  `2.5rem 1fr 1fr 1fr` template as `.avail-grid`.
- **The admin skeletons were never actually visible.** `#submissions-panel`,
  `#published-panel` and `#feedback-panel` are `display: none` in CSS and were
  only revealed *after* the fetch resolved — so the skeletons were built,
  inserted into hidden containers, and replaced by real content without anyone
  seeing them. Which panels to show depends only on the `?view=` parameter, not
  on the response, so that logic moved into `applyViewVisibility()` and now runs
  before the request as well as after.
- Caught by an assertion on the map stand-in's height coming back as `0px`.
  Every count-based check passed regardless, because `querySelectorAll` does not
  care whether an element is displayed — worth remembering when testing
  anything that is only meaningful when visible.

## 2026-08-26 — Retention job scheduled, and a stale-prompt trap

- `enforce_retention()` is now scheduled in the database via pg_cron (extension
  installed), job `elpys-enforce-retention`, `17 4 1 * *` — 04:17 UTC on the 1st
  of each month. The published retention schedule is now enforced by Postgres
  rather than by anyone remembering, and it does not depend on the Cowork task
  or on Vercel. Unschedule with
  `select cron.unschedule('elpys-enforce-retention');`.
- Monthly, not weekly: the window is 12 months, so month granularity is ample.
  pg_cron only ticks while the project is awake — a paused project skips a run
  and catches up on the next, immaterial here.

**Trap for anyone re-running the F-03 admin_notes prompt.** A prompt circulated
for this fix that specifies a column list including `id`, `created_at`,
`status` and `published_at`. That list **no longer works**: anon's table-level
grant has been replaced with a column-level grant covering only the 27 columns
the renderer uses plus `status`, so selecting `id`/`created_at`/`published_at`
as anon now returns `42501 permission denied` and would blank the site.
Verified against the live endpoint, not assumed.

- If a genuinely new public field is ever needed, it must be added in **both**
  places: `PUBLIC_COLUMNS` in `supabase-client.js` *and* the column grant to
  `anon`/`authenticated` on `public."Opportunities"`. Changing only the JS gets
  a permission error; changing only the grant gets an unused privilege.
- That prompt also names a column `needs_browser_check` to exclude. There is no
  such column on `Opportunities` — checked against `information_schema`.
  Harmless as an exclusion, but a sign the list was written against an assumed
  schema rather than the real one.

## 2026-08-26 — Corrections for the Project Context doc

Not a code change. This is a list for whoever next refreshes the "Elpys Project
Context" Google Doc — every item below was checked against the repo or the
database today, and each contradicts what the doc currently says.

- **"The 14 current opportunities" — it is 16.** Two one-time listings were
  added (ids 117, 118, Keep Bellevue Beautiful).
- **`Feedback` and `data_review_flags` are no longer "purpose unknown".**
  `Feedback` backs the feedback form (`api/feedback.js`). `data_review_flags` is
  the weekly accuracy check's queue and now has a whole UI on `/review`, with
  three sections and a red/yellow/green health dot in the admin header. Both
  still have RLS on with zero policies, and that is **correct by design** — all
  access goes through the service role server-side. It is not an open issue.
- The doc calls the `data_review_flags` FK unindexed. It is indexed now.
- **Open issue #4 (detail pages are individual static files with no rewrite
  rule) is resolved.** There is no `opportunities/` directory; there is one
  template, `opportunities-detail.html`, reading `?slug=` from the URL. A newly
  approved listing does not 404.
- **URLs are extensionless now.** `/about`, `/map`, `/submit`; the homepage is
  the bare domain. Old `.html` paths 308-redirect. Anywhere the doc writes a
  path like `opportunities/detail.html`, it is out of date.
- **The logo description is stale.** The doc describes "sunrise arcs"; the mark
  is now a torch — the "l" of the wordmark doubles as the handle, with a flame
  above it and sparkles behind. Files: `logos/elpys-favicon.svg`,
  `elpys-logo-mark.svg`, `elpys-logo-full.html`.
- **The colour tokens are stale.** Doc says `--body #1A1A1A`, `--border
  #E2E2E2`, `--muted #888888`. Actual: `#111827`, `#E5E7EB`, `#6B7280`. There is
  also a `--subtle` (`#767D89`, raised from `#9CA3AF` for WCAG AA contrast) and
  a `--dot-green/yellow/red` status set.
- **Open issue #5 (junk test rows) is half done.** Id 114 is gone. Id 115 still
  exists — name "a", status `pending`, created 18 Aug. It is *not* published, so
  it is invisible on the site and sits only in the admin queue. Left in place
  rather than deleted without asking.
- **`admin_notes` is no longer readable by the anon key** (see the entry below).
  The doc lists it as an ordinary column; it is now revoked at the database
  level from `anon` and `authenticated`.
- **Still true, do not "fix":** open issue #7, `noindex` is on all 13 pages and
  must come off at launch. Everything is on `main`. `signup_steps` is still
  pipe-separated text.

## 2026-08-26 — Legal review applied, and admin_notes closed off

- Landed the August 2026 legal review: `privacy.html` and `terms.html` rewritten
  (13 and 18 sections), and `analytics.js` pins five capture settings that
  `autocapture: false` does not cover. Commits `2e3c7a4`, `d1b0eb5`.
- Consent lines above the submit buttons on signup/submit/feedback, which moves
  the terms from browsewrap to sign-in-wrap. That is the difference between
  terms that bind and terms that mostly do not.
- **Reversed a decision from the day before.** `capture_performance: false` was
  pinned on 25 Aug because the then-current policy did not mention performance
  data. The rewritten policy discloses it, so the condition that justified the
  pin is gone and web vitals are back on, disclosed. Recorded so it does not
  read as drift.
- **`admin_notes` was publicly readable and is not any more.** `select=*` plus a
  table-level grant meant the anon key could pull the reviewer-notes field off
  the REST endpoint. Nothing had leaked — only internal build notes on two rows —
  but the form offers that box as a private channel to the reviewer.
- **The prescribed SQL did not work, and the verification is what caught it.**
  `revoke select (admin_notes) ... from anon` ran without error and changed
  nothing: Postgres cannot subtract a column from a *table-level* grant, and
  `anon` had one. `select=*` still returned the notes afterwards. The working
  fix is to revoke the table grant and re-grant the allowed columns:
  `revoke select on public."Opportunities" from anon, authenticated;` then
  `grant select (<27 columns>, status) ... to anon, authenticated;`.
  Anyone repeating this pattern on another table needs the same shape.
- `status` has to be in the grant even though the client never selects it —
  PostgREST filters on it, and filtering a column requires SELECT on it.
- Client-side change shipped *before* the database change, deliberately: a
  missed column then shows as blanks and is fixable, rather than taking the live
  site down. `service_role` keeps its table grant, so the admin panel is
  unaffected — verified, not assumed.
- Retention: `privacy.html` section 7 now publishes a 12-month schedule for
  feedback and declined submissions. Added `public.enforce_retention()` in
  Supabase (SECURITY DEFINER, execute granted to `service_role` only) so the
  weekly check needs one line: `select * from public.enforce_retention();`.
  Nothing is over 12 months yet, so today it deletes zero rows.
- **Open follow-up:** that function is not scheduled. The weekly data check is a
  Cowork task (`trig_01YcPNPrCWaQegPxhpBE2a5J`) which Claude Code cannot edit, so
  a person has to add that one line to it. pg_cron is available but not installed
  if a database-native schedule is preferred instead. Until then the published
  retention promise has nothing enforcing it.

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
