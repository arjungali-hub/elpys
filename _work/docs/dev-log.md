# Elpys dev log

Chronological record of changes made via Claude Code, newest first. This file is
part of the repo's GitHub sync into the Elpys Claude Project, so Cowork sessions
can read it automatically. It's a supplement to `elpys-project-context.md` (which
lives in the Claude Project itself, not this repo, and is the narrative canonical
doc) — this file is the raw log a Cowork session pulls from when refreshing that
doc, not a replacement for it.

## 2026-08-31 — The admin verification gate

- Part 2 of the org-verification work: a pending listing can no longer be
  approved without a completed verification record. Server-side, in
  api/admin.js, a new verificationError() runs inside the approve action
  before the PATCH and rejects with a specific message (missing legal name,
  bad domain, an unconfirmed check) - this is the actual gate. It requires
  org_tier (government or charity), a bare org_domain with no scheme/www,
  org_legal_name, and a verification.checks array containing a passing entry
  for exclusions_confirmed always, plus org_official_site for government or
  all four of irs_exempt / irs_not_revoked / wa_charity_active /
  form_990_on_file (with EIN and a WA charity number) for a charity.
- The four charity check names came from the prompt; the government checkbox
  and the always-required exclusions confirmation didn't have names given to
  them there, only descriptions ("one checkbox", "a final confirmation
  checkbox") - named them org_official_site and exclusions_confirmed and
  enforced both server-side too, since the whole point stated up front was
  that a stale tab or a hand-rolled request can't skip it, and leaving those
  two client-only would have quietly broken that for two of the checklist's
  items.
- admin.html grew a verification panel: government/charity radio, always-on
  legal name + domain fields, then either the one government checkbox or the
  four charity checks (each with a lookup link and a source-URL field) plus
  EIN and WA charity number. It appears on pending cards, tied directly to
  Approve - disabled until readVerification() (a client-side mirror of the
  server check, for a same-page answer instead of a 400) reports complete -
  and again on published cards' edit view, for correcting or backfilling
  verified_at afterward. verified_at itself is only ever set in one place,
  server-side, inside approve - never by update, and nothing client-side can
  reach it.
- Two bugs the local harness caught before this went anywhere near
  production: the gate briefly read as "complete" on first paint, because
  its initial check ran via document.getElementById on a pending card that
  was still a detached node at that point in construction (fixed by scoping
  the lookup to the card itself); and switching from government to charity
  and back left the other tier's checkboxes checked, so a charity record
  could pick up a stray org_official_site: pass it never earned (fixed by
  clearing the inactive tier's fields on switch).
- Published rows with the older research shape the weekly cloud task wrote
  (a flat object of sourced facts, not a checks array) show that JSON
  verbatim in a collapsed "reference only" panel rather than trying to parse
  it into the new checklist - a human still has to run the four checks and
  check the boxes themselves before verified_at gets set. Rows 91/92/93 are
  exactly this backfill queue. Published rows with verified_at still null
  get a "Not yet verified" badge in the list so the queue is visible without
  opening each one.
## 2026-08-31 — Repo tidy-up, and the organization-verification public pages

- Ran the prepared reorganization: everything that is not the website moved
  under _work/ (already gitignored) - patches, the opportunity-scout skill
  archive, the loading-states design source, and the notes/status/log
  folders that used to sit untracked-but-not-ignored at the repo root. That
  last state is exactly how a skill archive reached the live site once
  (568bb20); this closes it by construction.
- docs/dev-log.md moved to _work/docs/dev-log.md via git mv, since it was
  already tracked. History follows the rename; it stays committed and pushed
  exactly as before, this file included. Verified before running anything:
  the other five items were untracked, this one was not, and the prompt that
  drove this assumed all six were - checking rather than trusting that
  assumption is what caught it.
- Applied _work/patches/elpys-org-verification.patch: how-we-check.html (the
  public statement of the two-tier org check, and section 6 - what it does
  not cover - which matters more than the parts that sound reassuring), a
  "Before your first visit" safety block on the detail page, and a
  ?concern=org path through feedback.html that shows a take-down-first
  notice and seeds the message so an organization concern is distinguishable
  from a typo report without a schema change.
- One test result worth recording so it is not re-litigated: every page
  failed a local "no console errors" check on /lantern/static/array.js
  404ing. That is not a defect in this patch - it is today's PostHog proxy
  change, and my local static-file test server does not simulate Vercel's
  rewrite. Confirmed clean against the real deployed site with a real user
  agent before trusting that explanation.
## 2026-08-31 — PostHog routed through a same-origin reverse proxy

- `/lantern/*` now rewrites to PostHog's US endpoints in vercel.json, and
  analytics.js points `api_host` at that relative path instead of
  us.i.posthog.com directly. Ad blockers keep domain blocklists that catch
  known analytics hosts; routing through the site's own origin avoids that
  class of undercounting. `ui_host` stays pointed at the real posthog.com so
  toolbar/dashboard links still resolve correctly.
- The PostHog domains came out of the CSP entirely (script-src and
  connect-src) - traffic is same-origin now, covered by 'self'. If the proxy
  is ever removed, those entries need to come back; the code comment says so.
- privacy.html needed no change - it already describes PostHog as the data
  processor, never the transport domain, so nothing there became inaccurate.
- Verified against the live site with a real user agent (not headless
  Chrome's default - PostHog silently drops that): all four /lantern
  requests (loader, config, and both event endpoints) returned 200, and an
  explicitly captured event came back from PostHog with a real event UUID.

## 2026-08-30 — The Data review dot now reads real task_runs health, not a guess

- Arjun asked what the red dot meant. The honest answer was that it did not
  mean anything real: red fired on "no database write in 5+ days," a proxy for
  Supabase pausing that cannot see reads, so an ordinary quiet week read as an
  imminent pause while the project was ACTIVE_HEALTHY the whole time.
- The fix is not a threshold tweak. task_runs (cloud_weekly / local_verify) was
  already being upserted by both automated safety nets every run - the cloud
  check's own prompt says outright "this is how the admin Data review page
  colours its traffic light" - and nothing ever read it. Wired that up for
  real; deleted the write-recency proxy rather than adjusting it.
- Red is now reserved for Supabase being unreachable RIGHT NOW, confirmed by a
  live probe - the state that actually starts the real failure mode (a project
  paused too long is deleted, not just parked). This app has no way to know
  the exact day count toward that - it lives in the weekly check's own log -
  so the detail text says where to look rather than inventing a number.
- Live right now: there is no cloud_weekly row in task_runs at all, so the
  correct state is yellow "Weekly check has never reported in" - a real
  finding, not a guess. Worth Arjun's attention: the cloud task's own
  contract says to write that row on every run, success or failure, and it
  apparently never has.
- review.html previously never showed this status object at all - only a
  header tooltip on OTHER pages did, which is no help if you don't know
  there's something to hover. It now renders in an always-visible panel on
  the page itself.
- Found and left alone: a concurrent reorganization of the working tree
  (_work/, an updated .gitignore, an untracked organize-elpys.ps1) was already
  in progress when this started - _work/README.md changed while it was being
  read. Confirmed docs/dev-log.md stays tracked regardless of that .gitignore
  change (already-tracked files are unaffected by a later ignore rule), then
  left every one of those files uncommitted rather than touch something another
  session was actively mid-edit on.

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
