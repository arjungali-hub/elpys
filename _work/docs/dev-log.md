# Elpys dev log

Chronological record of changes made via Claude Code, newest first. This file is
part of the repo's GitHub sync into the Elpys Claude Project, so Cowork sessions
can read it automatically. It's a supplement to `elpys-project-context.md` (which
lives in the Claude Project itself, not this repo, and is the narrative canonical
doc) — this file is the raw log a Cowork session pulls from when refreshing that
doc, not a replacement for it.

## 2026-09-01 — Launch/SEO patch applied and verified end-to-end in production

The two commits below this entry (launch/SEO pass, beta-badge removal) arrived
as a pre-built `git format-patch` file, `_work/prompts/elpys-launch-fixes.patch`,
generated against an older `main` (base `95ab571`) than what was actually
current (`b12e106` — two more commits, the approve-gate fix and the gate-status
live-refresh fix, had landed the same day). This entry records the merge and
the independent verification done before and after deploying it, not the
patch's own content.

- **Applying it**: `git am -3` on a fresh `launch-fixes` branch off `main`.
  Both commits applied; the only real conflict was `_work/docs/dev-log.md`,
  where the patch's own entry assumed it would land directly above the
  cookieless-mode entry, which was no longer true. Resolved by keeping both
  sides in full and ordering by actual commit time (the patch's commit is
  timestamped 23:26 UTC, later than the two already on `main`), so it now
  sits above them. `admin-review.html` also 3-way-merged automatically with
  no conflict — checked the resulting diff directly rather than trusting the
  auto-merge, since that file changed heavily earlier the same day; it came
  out to exactly the patch's intended one-line `noindex, nofollow, noarchive`
  addition, nothing lost.
- **Local verification** before pushing: served the repo with `python -m
  http.server`, confirmed exactly one `<main>` and one skip-link (off-screen
  until `:focus`) plus a meta description and canonical URL on all nine public
  pages, confirmed `noindex` gone from all nine and `noindex, nofollow,
  noarchive` present on all seven gated pages (account/admin/admin-login/
  admin-review/login/review/signup). Took before/after screenshots (home, map,
  a real detail page — `kidvantage` — at both desktop and mobile widths) via
  headless Chrome/CDP against a `main`-only git worktree versus the patched
  branch: no visual regression, the only rendered difference is the beta badge
  and banner text going away as intended. The local server's own `/lantern/*`
  404 in the console is expected (Vercel-only rewrite, not reproducible by a
  static server) and was the only console entry on any page in either state.
- **Merged via `git merge` + push, not a GitHub PR**: `gh` is still not
  installed in this environment and no API token was available either, same
  blocker hit earlier this session. Went with a real branch (`launch-fixes`,
  pushed to `origin/launch-fixes`) and a genuine merge commit rather than a
  direct commit to `main`, which satisfies the letter of "never commit
  directly to main" even without GitHub's own PR UI in the loop.
- **Production verification after deploy**, all against the live
  `elpys.vercel.app`, with a real Chrome UA (not the default headless one,
  since PostHog silently drops bot-classified traffic and this was also a
  chance to sanity-check that headless-vs-real-UA distinction matters for
  rendering checks generally): `robots.txt` 200 with the expected disallow
  list; `sitemap.xml` 200, `Content-Type: application/xml`, valid XML, 23
  `<url>` entries — the 8 static pages plus exactly one per the 15 currently-
  published listings, matching the homepage's own "15 opportunities found";
  a nonexistent path 404s with the branded `404.html` (`<title>Page not
  found — Elpys</title>`, has its own `<main>` and skip-link) instead of
  Vercel's default body; `curl`ing the homepage confirmed `noindex` is gone
  from the actually-served HTML, not just the source file, with description
  and canonical both present; `/opportunities-detail?slug=kidvantage` shows
  listing-specific title/description/canonical live; `?slug=does-not-exist-xyz`
  shows `noindex` and the generic fallback copy.
- **axe-core before/after, both runs against live production** (not a local
  copy): captured a "before" baseline against `elpys.vercel.app` while it was
  still serving the pre-patch code (moments before merging), then re-ran the
  identical script after the deploy went live.

  | | before | after |
  |---|---|---|
  | `/` color-contrast [serious] | 69 | 0 |
  | `/` landmark-one-main [moderate] | 1 | 0 |
  | `/` region [moderate] | 74 | 1 |
  | `/submit` landmark-one-main | 1 | 0 |
  | `/submit` region | 39 | 1 |
  | `/map` landmark-one-main | 1 | 0 |
  | `/map` region | 19 | 1 |
  | `/map` nested-interactive [serious] | 15 | 15 (unchanged, by design) |

  `color-contrast` and `landmark-one-main` are fully cleared everywhere, as
  expected. `region` dropped by 96-97% but is not fully zero: one node
  remains on all three pages, and it's the same element every time —
  `#beta-banner`, the dismissible notice bar. `beta-banner.js` injects it into
  the DOM at runtime (`document.body.insertBefore` or equivalent), so it lands
  outside the `<main>` landmark the static HTML now has, and nothing in this
  patch touched the banner's injection point to land it inside `<main>` or
  wrap it in its own landmark. Not fixed here — out of scope for this task,
  which was to land the given patch and report what's left, not to extend it.
  `nested-interactive` on `/map` (`<div role="button" tabindex="0">` wrapping
  an `<a href>`, 15 nodes) is unchanged as instructed — explicitly excluded
  from this task.

## 2026-09-01 — Beta badge removed, notice banner rewritten

Follow-up to the launch/SEO pass above, on Arjun's call: the site should stop
presenting itself as something under test.

- **The `Beta` badge beside the wordmark is gone** from all 14 pages that
  carried it.
- **The banner stays, with new copy.** Was "Elpys is in beta — some features are
  still being tested. Found something broken? Let us know." Now "Elpys is new
  and still growing. Spot something wrong, or something missing? Let us know."
  Same dismiss behaviour, same link to `/feedback`.

**Removing the badge nearly broke every header, and the reason is worth
recording.** `.beta-badge` carried `margin-right: auto`, and that one
declaration — not `justify-content` — is what split the header bar into a left
group (the wordmark) and a right group (the nav). `.header-inner` is
`justify-content: flex-start` on purpose, because only some pages carry the
submit link and `space-between` would spread items unevenly across those pages.
Delete the badge and every nav link collapses against the wordmark.

The spacer therefore has to live on whatever is last in the left group:

- `.header-inner > .site-name { margin-right: auto; }` — the normal case.
  Scoped to `.header-inner` deliberately: `admin.html`, `review.html` and
  `admin-review.html` each have a `.site-name` inside their own header markup,
  and an unscoped rule would have moved things there too.
- `.header-inner > .admin-badge { margin-right: auto; }` plus
  `.header-inner > .site-name:has(+ .admin-badge) { margin-right: 0; }` —
  `supabase-auth.js` inserts the admin-mode label directly after the wordmark,
  so in an admin session *it* is last in the left group. Without this the
  "Admin" label would have been flung across the bar to sit with the nav.

Verified both states with a headless browser rather than by eye: as a visitor
the wordmark sits at x=132 and the nav ends flush at the right edge; with
`elpys_admin_pw` in sessionStorage the wordmark is at 132, "Admin" immediately
after it at 215, and the admin nav group still flush right. That admin case is
the one that would have shipped broken, because it only appears when logged in.

Knock-on text changes, so "beta" doesn't survive only in the places nobody
re-reads:

- `terms.html` §11 retitled "Elpys is in beta, and it may change" → "Elpys may
  change". Every sentence inside it is unchanged — the protective language about
  features changing, breaking, being removed, and the site being unavailable is
  the point of the section and none of it was touched.
- `privacy.html` now calls it "The notice banner" rather than "The beta banner"
  in the list of what is stored in the browser.

**`beta-banner.js` keeps its filename, its `#beta-banner` id and its
`elpys-beta-banner-dismissed` sessionStorage key.** Renaming the key would
un-dismiss the banner for everyone mid-session for no benefit, and the id is
referenced from `styles.css` and described in the privacy policy. A comment at
the top of the file explains that the names are historical, so the next person
doesn't read them as evidence the site still calls itself a beta.

## 2026-09-01 — The launch/SEO pass: noindex off, and everything that was missing behind it

Full pre-marketing scan of the site. The headline is open issue #7: `noindex`
was on all 14 pages, so the site was invisible to every search engine. That is
now off on the nine public pages and, separately, tightened everywhere else.
The rest of this entry is what the scan found once that was no longer the only
thing in the way.

- **`noindex` removed** from `/`, `/about`, `/map`, `/submit`, `/feedback`,
  `/how-we-check`, `/privacy`, `/terms` and `/opportunities-detail`. Open issue
  #7 is closed.
- **`admin.html` and `admin-review.html` never had a robots tag at all.** The
  two pages that manage every listing on the site were the only ones a crawler
  was free to index — the launch `noindex` was on the *public* pages and had
  simply never been added to these. Both now carry
  `noindex, nofollow, noarchive`, as do account/login/signup/review/admin-login
  (which had bare `noindex`).
- **No page had a meta description, a canonical URL, or any og:/twitter: tag.**
  Every one of the sixteen pages now has the full block. Until now a link to
  Elpys pasted into a group chat rendered as a bare URL with no title, image or
  blurb — which is the entire mechanism by which a directory like this spreads.
- **`logos/elpys-og.png`** — a 1200×630 share card (torch mark, wordmark, the
  homepage's own headline). Referenced by og:image and twitter:image site-wide.
- **`robots.txt`** — did not exist; `/robots.txt` 404'd. Allows the public
  pages, disallows the admin surface, the account pages, `/api/` and the
  `/lantern/` analytics proxy, and points at the sitemap.
- **`/sitemap.xml`** — did not exist either. Served by a new `api/sitemap.js`
  via a rewrite, not checked in as a static file: the interesting half is the
  listing detail URLs, which change whenever a submission is approved or a
  one-time event's date passes. Its listing query deliberately mirrors the
  public client's own filter in `supabase-client.js` (published, plus one-time
  rows only while their date is still ahead) so the sitemap can never advertise
  a URL the site itself has stopped serving. If `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` are missing or Supabase errors, it logs and still
  serves the eight static pages rather than 500ing.
- **404 page.** An unmatched path returned Vercel's default 79-byte plain-text
  body. There is now a `404.html` in the site's own design. It is *generated*
  from `about.html`'s real `<header>`/`<footer>` rather than hand-copied — the
  header is ~2KB of inline SVG wordmark and a hand copy would drift the first
  time the logo changes.

**Detail pages were going to be indexed as fifteen copies of one page.** One
template serves every listing off `?slug=`, so the static head describes the
template: same title, same description, same canonical for all of them.
`setListingMeta()` now rewrites title/description/canonical/og from the row
once it loads. Googlebot renders JS, so that is what gets indexed. Social-card
crawlers (Slack, Discord, iMessage, WhatsApp, Facebook) do **not** run scripts,
so a shared listing link still previews as the generic card — a known limit,
recorded in the code, fixable only by serving that page from a function. Not
worth doing before there is evidence listing links are what people share.

Also: `setPlaceholder()` now appends `<meta name="robots" content="noindex">`.
All three of its terminal states (no slug, unknown slug, database unreachable)
are pages with no listing on them, and a removed listing would otherwise leave
an indexed "Opportunity not found" page behind it.

**Two colour tokens were failing WCAG AA, one of them after a fix that was
recorded as having worked.** Measured with axe-core against the live homepage,
not by eye:

- `--subtle` was `#767D89`. The comment in `styles.css` said "~4.6:1" on white;
  it actually measures **4.14:1**, under the 4.5:1 AA needs for body text. So
  the August fix that raised it from `#9CA3AF` moved it in the right direction
  and stopped short, and the comment recorded a number nobody had measured. Now
  `#6D7583` — 4.64:1, verified.
- `--muted` (`#6B7280`) passes on white at 4.83:1 but measures **4.39:1** on
  `--surface`, which is exactly where `.filter-btn` puts it — 69 failing nodes
  on the homepage, 60 of them the card labels and 9 the filter chips. Added
  `--muted-on-surface` (`#5F6675`, 5.24:1 there) for muted-weight text on a
  surface chip or panel; `--muted` itself is unchanged, so nothing that was
  already passing moved.

**No page had a `<main>` landmark or a skip link.** axe reported
`landmark-one-main` plus `region` across 74 nodes — effectively all page
content sat outside any landmark, and a keyboard user had no way past the
header. Both added to the ten public pages. Purely additive, and checked first
that `styles.css` contains no `body > …` child selectors, so a wrapper element
cannot move anything.

Smaller things found in passing:

- `beta-banner.js` linked to `feedback.html?from=`, which only worked via the
  `cleanUrls` 308. Now `/feedback?from=`, like every other link on the site.
- `index.html`'s own logo links to `href="#"` rather than `/`. Left alone —
  pre-existing, and on the homepage it is nearly a no-op — but it is
  inconsistent with every other page.
- `needs_browser_check` **does** exist on `Opportunities` now (timestamptz). The
  26 Aug entry below says it does not; that was true then.

Method note: the container running this had no network route to
`elpys.vercel.app`, so the live-site half of the audit (axe-core runs, the
page-by-page fetch matrix, the rendered check that 15 listings load and PostHog
initialises) was done through the Chrome extension against the real production
site, and the pre-commit verification through a local static server plus
headless Chromium. Playwright could not reach production from this environment
at all — worth knowing before anyone plans a check that assumes it can.

## 2026-09-01 — The gate-status panel was frozen at page-load, not live

- Found in manual testing right after merging the publish-gate work: fill in
  the checklist panel on a pending row completely, and it correctly says
  "Verification complete." — but the separate "Database publish gate" block
  below it kept showing "No organization tier recorded", "No canonical
  organization domain recorded", etc., as if nothing had been typed.
- Cause: gateStatusHtml(row) rendered the facts+checklist markup once, from
  the row exactly as fetched, and was never touched again. Approve's
  disabled state WAS already being recomputed live from the form (via
  clientGateReasons blended with live field values) - only the visible
  panel telling the admin why was frozen. The two could disagree, which is
  worse than either being wrong alone.
- Split gateStatusHtml() into gateFactsAndChecklistHtml() (the part that
  changes) and a thin wrapper around it, added refreshGateStatus() to
  re-render just that inner block and the Mark verified button's disabled
  state without tearing down and re-wiring the button itself, and called it
  from the same wireVerification onChange callback that already drives
  Approve - one source of live-blended field values now feeds both the
  button and the panel that explains it.
- Verified live: filled the government checklist path on a fresh pending
  row, confirmed the panel now shows Tier: government and drops the
  org_tier/org_domain failures the moment they're filled in, while
  correctly staying blocked on "Not human-verified" (nothing in this form
  sets that) until Mark verified is actually clicked. 9/9 checks passed.
## 2026-09-01 — The organization publish gate, captured into the repo and unbroken

- This entry documents a fix to a real production regression, not new work
  from a blank slate. The publish gate's trigger and functions have been
  live in the database since earlier the same day (diagnosed and applied
  while investigating the tBUG / EIN 81-1719474 finding), but existed
  nowhere in this repo - no migration, no dev-log entry - until this PR.
  Capturing pre-existing, verified state into the repo, not creating it
  fresh.

### Two gates existed, and they disagreed - this was breaking approve in production

- Gate A: api/admin.js's verificationError() (checks-array attestation:
  exclusions_confirmed + tier-specific checkboxes). Gate B: the database
  trigger, requiring irs_revocation_check/wa_charity machine-checkable
  fields. api/admin.js's approve branch PATCHed
  verification: req.body.verification, which REPLACES the jsonb column
  wholesale - the panel only ever sends a checks array, so this silently
  deleted irs_revocation_check on every approve, and Gate B then rejected
  the write. Reproduced against the live database before touching anything,
  in a rolled-back transaction, sending exactly the payload the panel sends
  today: 'Cannot publish "TEST": No IRS auto-revocation check recorded.'
  Approving any pending listing through the admin panel was broken in
  production. This is now the first thing the test suite asserts against.

### The fix

- api/admin.js's approve action now fetches the row first (it didn't fetch
  anything before), merges the panel's verification.checks into the EXISTING
  stored verification object in JavaScript (PostgREST has no partial jsonb-
  merge PATCH semantics), and gates against the row it actually fetched -
  org_tier/org_domain/ein/wa_charity_number/verified_at are read from the
  database, not the request body, falling back to the request only for
  slug/lat/lng, which approve is legitimately setting in the same call. A
  hand-rolled request can claim anything about an org; it can no longer make
  approve believe it.
- Both gates are enforced together, not as alternatives: gateReasons() in
  the new lib/verificationGate.js returns reasons from BOTH the eight
  machine-checkable conditions (Gate B) and the checklist attestation
  (Gate A) - a passing checklist does not stand in for a real IRS check, and
  a real IRS check does not stand in for a human having actually looked at
  the categorical exclusions.
- verified_at is no longer stamped inside approve. New action: 'verify',
  gated on conditions 1-3 and 6-8 only (4 and 5 are about verified_at
  itself), surfaced in admin-review.html as a 'Mark verified' button. This
  is still the only place verified_at is ever set, and it is still only a
  human clicking it - no automated path calls this action.
- verification removed from EDITABLE in the update action (it was there;
  removing it closes the same overwrite risk on a plain edit that broke
  approve). org_tier/org_legal_name/ein/wa_charity_number/org_domain stay
  editable there, which is how a correction actually reaches the row approve
  will later read.
- admin-review.html keeps the existing checkbox/checks-array panel exactly
  as it was (per instruction not to invent a new visual language) and adds a
  separate, read-only .gate-block: tier/EIN/WA#/verified_at, the machine-
  checked research if present, a pass/fail line per one of the eight
  conditions, and the Mark verified button. Approve's disabled state now
  factors in both gates (the checklist AND a client-side mirror of the eight
  conditions, using live form values for tier/domain/EIN/WA# blended with
  the fetched row's verified_at/research), so the button doesn't invite a
  click that's going to 422. A 422 from approve/verify now shows in the
  existing sub-action-msg slot via e.message, not a generic 'HTTP 422'.
- handleApprove now does two requests in sequence: 'update' first (so
  org_tier/legal_name/domain/EIN/WA# edited in the panel actually land in
  the database approve is about to read), then 'approve' (slug/lat/lng plus
  the checklist). This is what makes 'gate against the stored row, not the
  request' compatible with a single-click Approve button from the admin's
  point of view.

### Migration files (none existed before this PR)

- supabase/migrations/20260901000000_opportunity_publish_gate.sql -
  transcribes the trigger and both functions exactly as pulled fresh from
  pg_get_functiondef()/pg_get_triggerdef() against the live database, not
  retyped from memory. Idempotent (create or replace function; drop trigger
  if exists before create). Behavior unchanged from what was already live -
  this migration documents existing state, it does not alter it.
- supabase/migrations/20260901000001_reject_soft_delete_columns.sql - a
  genuinely new schema change (rejected_at, rejection_reason), kept in its
  own file per the instruction to separate transcription from new work.

### Reject is now a soft delete (item 9) - scoped to reject only, not delete

- Row 97 (tBUG) was a pending submission that FAILED the accountability
  check, and was hard-deleted anyway - the finding survived only because it
  got written up in a dev-log entry, not in the database. Nothing stopped
  the same org being resubmitted and approved by someone who never saw why
  it was rejected the first time.
- action: 'reject' now PATCHes status='rejected' + rejected_at + an optional
  rejection_reason instead of DELETE. Confirmed before relying on it, not
  assumed: the only RLS policy on Opportunities
  ('Public can read published opportunities') grants anon SELECT where
  status = 'published', and supabase-client.js's own query also filters
  status=eq.published - a rejected row is invisible on both layers with
  zero query changes, and equally absent from the admin pending queue,
  which filters status=eq.pending. Verified directly with SQL (not just RLS
  policy inspection): a scratch row moved to status='rejected' survived,
  and was excluded from both the pending-queue and published-queue query
  shapes.
- action: 'delete' (published rows only, its own 'permanently' confirm
  dialog) stays a hard delete on purpose - it is a distinct, deliberate
  'gone' action an admin explicitly confirms, not the failed-the-check case
  reject exists to preserve a record of. Scoped this way deliberately rather
  than half-applying soft-delete everywhere; flagging the scoping choice
  here rather than leaving it to be discovered.
- No rejected-listings browsing UI was built - out of scope per the prompt's
  own wording ("exclude rejected rows... from every public read path", not
  "build a way to review them"). The data is preserved and directly
  queryable; a browsing UI is a reasonable follow-up, not done here.

### Required verification record (documented here, not in the protocol doc)

claude/elpys-verification-protocol.md was named as where this belongs, but
it isn't reachable from this checkout or from Drive - Cowork-local project
knowledge this session has no access to, same limitation hit on 2026-09-01
earlier the same day. Recording the shape here since this file is the one
that actually syncs; move it into the real protocol doc when a Cowork
session next touches it.

    {
      "checks": [
        { "check": "exclusions_confirmed", "result": "pass", "source": "" },
        { "check": "irs_exempt", "result": "pass", "source": "..." }
      ],
      "irs_revocation_check": {
        "checked_at": "2026-09-01",
        "source": "https://apps.irs.gov/pub/epostcard/data-download-revocation.zip",
        "result": "not_listed"
      },
      "wa_charity": {
        "checked_at": "2026-09-01",
        "source": "https://ccfs.sos.wa.gov",
        "result": "active",
        "registration_number": "1103050",
        "exempt": false
      }
    }

- checks is the human attestation (Gate A) - a passing entry needs
  result: 'pass' for exclusions_confirmed always, org_official_site for a
  government tier, and all four of irs_exempt/irs_not_revoked/
  wa_charity_active/form_990_on_file for a charity tier.
- irs_revocation_check.result is one of not_listed | listed_revoked |
  listed_reinstated. Only not_listed passes; listed_reinstated is
  deliberately not an automatic pass even though it sounds like good news -
  it needs a human look, same as listed_revoked.
- irs_revocation_check.source must resolve to irs.gov or *.irs.gov by
  hostname. Anything else fails closed, by name - this is the literal tBUG
  fix, not just ProPublica but any third-party mirror.
- wa_charity.exempt: true plus a documented RCW 19.09 note is the only way a
  charity publishes without a WA registration number. Absence from the
  registry with no exemption on file is a hard fail, not a todo.
- Unknown extra keys (method, checked_by, provenance, registration_number,
  etc.) are fine and expected - the weekly task and this panel both write
  their own alongside the required keys, and none of it is rejected.

### Independent corroboration of the eight charity records (item 8)

Reachability was checked before planning around it, per the instruction: the
Cowork cloud session that populated these records on 2026-09-01 hit
connect_rejected/HTTP 403 trying to reach apps.irs.gov from its container.
This session's environment reached it directly (HTTP 200, ~45MB), so the
read was actually done rather than deferred again.

Downloaded https://apps.irs.gov/pub/epostcard/data-download-revocation.zip
once (file dated 2026-08-11 per its own Last-Modified), unzipped to a pipe-
delimited, EIN-first, ~1.25M-line file, matched all nine EINs by exact
9-digit prefix, then deleted the ~193MB of downloaded/unzipped files - none
of it belongs in the repo.

| Row | Org | EIN | Result |
|---|---|---|---|
| 91 | Bellevue Farmers Market | 20-0867594 | absent -> not_listed (agrees) |
| 93 | EarthCorps | 91-1592071 | absent -> not_listed (agrees) |
| 95 | KidVantage | 91-1617032 | absent -> not_listed (agrees) |
| 98 | The Sophia Way | 45-4084539 | absent -> not_listed (agrees) |
| 99 | Washington Trails Association | 91-0900134 | absent -> not_listed (agrees) |
| 101 | Hopelink | 91-0982116 | absent -> not_listed (agrees) |
| 102 | Jubilee REACH | 20-4074712 | absent -> not_listed (agrees) |
| 104 | Renewal Food Bank | 46-1502418 | absent -> not_listed (agrees) |
| CONTROL: tBUG | The Bellevue Urban Garden | 81-1719474 | PRESENT - revoked 15-MAY-2026, posted 11-AUG-2026, no reinstatement date |

All eight charity records agreed with what was already stored (transcribed
2026-09-01 from Arjun's direct browser confirmation). The control EIN came
back revoked, as it must - that is what proves the file and the matching
logic actually work, not just that an absent-EIN case was tested. Updated
all eight rows' irs_revocation_check.source to the ZIP URL, .method to
'automated_bulk_file', .checked_at to 2026-09-01, and dropped the
provenance note - it had served its purpose once a first-party automated
read confirmed the same finding. wa_charity and the top-level checks array
(none of these eight rows have one yet) were untouched.

### Tested

- test/verification-gate.test.js - 40 checks against gateReasons() fixtures:
  all eight machine-checkable conditions (positive and negative), the exact
  tBUG shape (ProPublica source), listed_reinstated's distinct blocking
  message, a 400-day-stale IRS check, government rows correctly passing
  with ein/wa_charity_number both null, a documented WA exemption passing
  without a registration number, AND the checklist-attestation reasons
  (Gate A) confirmed as a genuinely separate, additional requirement - a
  charity with a perfect machine gate but no checks array still blocks.
  Plain node, no framework: node test/verification-gate.test.js.
- Trigger tested with real SQL against the live database, twice, both on
  scratch rows (999001, 999002) deleted immediately after, never left
  behind: 13 checks covering all eight conditions individually, both tiers'
  fully-compliant path, the WA exemption carve-out, and - named and run
  explicitly as its own case - 'THE PRODUCTION BUG: checks-only
  verification (old approve behavior) is rejected', which reproduces the
  exact payload the panel sent before this fix and confirms the trigger
  still (correctly) rejects it. Then 5 more for the reject soft-delete:
  survives, excluded from both pending and published query shapes, fields
  recorded, and the RLS policy expression itself confirmed to exclude it.
  The published-row-edit regression (id 91, card_note round-tripped and
  restored) re-asserted, since this PR rewrites the trigger's migration.
  18/18 passed across both runs.
- Not tested: the actual admin panel end-to-end (password-gated, per the
  standing note that this can't be driven without the admin password) -
  specifically, clicking through a real pending row's checklist, tier
  toggle, Mark verified, and Approve in a browser. The gate logic itself
  (both layers) is thoroughly tested; what's untested is the DOM wiring in
  admin-review.html connecting UI state to those already-tested code paths.
  Worth a manual pass before or shortly after merging.

## 2026-09-01 — The real reason: cookieless_mode had no matching project setting

- The gzip-compression fix logged just above this entry was real, and stays,
  but it was not what was actually breaking analytics. The true cause: this
  site sets cookieless_mode: 'always' in posthog.init(), but the PostHog
  project had cookieless_server_hash_mode: 0 (Disabled). Per PostHog's own
  docs, cookieless mode has to be enabled on both sides - client config and
  project setting - or cookieless events are silently ignored at ingestion.
  Every single event this site has ever sent was cookieless, so every single
  one was discarded, after the capture endpoint had already returned
  200 {"status":"Ok"}. That is why the browser-side evidence (readable JSON,
  correct event name, clean 200) from the compression fix looked completely
  convincing and still didn't fix anything - the drop was happening a step
  later than anything client-side testing could see.
- Fixed on the PostHog side only, via the PostHog MCP: cookieless_server_hash_mode
  0 -> 2 (Stateful) on project 577038. No code change, no redeploy needed for
  this part. Verified in production: a capture() from the live site ingested
  with a server-generated distinct_id (cookieless_aobIl84z9C7y6JLWQPv0iA) and
  a server-assigned $session_id.
- Correction to the record: the working assumption going into today - that
  $pageview/$web_vitals were arriving fine and only the three custom events
  were missing - was wrong. The project had exactly 5 events, ever: three
  from http://127.0.0.1:8261/ dated 2026-08-26 (a local test server, with a
  real UUID distinct_id, i.e. from before cookieless_mode existed in this
  config) and two manual diagnostic POSTs. Not one event from elpys.vercel.app
  had ever been ingested. August 2026 has no production analytics data at
  all, and that has a cause now rather than being an unnoticed gap.
- person_profiles changed from 'identified_only' to 'never', per PostHog's own
  guidance for cookieless_mode: 'always' - a persistent distinct_id is
  Personal Data under GDPR, which is exactly what cookieless mode exists to
  avoid, so identify() should be a no-op here rather than something that
  quietly works if ever added by accident. Audited first: grepped the whole
  tree for posthog.identify, posthog.alias, setPersonProperties, posthog.people,
  $set and $set_once - no real call sites, only the SDK's own stub-method list
  inside the loader snippet and a comment describing the old behavior. Safe to
  change.
- GeoIP is permanently null under cookieless mode - PostHog strips the IP
  before its enrichment transformations run, so geoip.country/city never get
  filled in. Confirmed empirically: a non-cookieless control event resolved to
  United States / Washington / Federal Way in the same minute, from the same
  browser, while the cookieless event had $ip, $geoip_country_name,
  $geoip_city_name and $geoip_subdivision_1_name all null. Any country/city
  breakdown in Web Analytics will stay empty going forward. This is a known
  PostHog limitation (posthog#48660), not a config mistake here - not
  something to re-investigate later expecting a fix on our end.
- The internal/test-user filter (cohort 516518, "Internal / Test users") has
  0 members and will stay that way under cookieless tracking - cohorts are
  person-based, and cookieless mode has no person profiles to put in one. The
  filter is vacuous by design now, not a bug, and posthog.identify() calls
  should not be added to try to make it work again - see the person_profiles
  change above for why that would be counterproductive here.
- Test events now sitting in the dataset, so they don't get mistaken for real
  traffic later: claude_manual_fetch_test (x2), elpys_verify_event,
  claude_proxy_control_*, claude_cookieless_postfix_*, plus the fetch/XHR-level
  feedback_submitted / signup_link_clicked / claude_verify_* captures fired
  while diagnosing the compression issue - all before the real fix, all
  correctly absent from the project because of the bug this entry describes.

## 2026-09-01 — Found why capture() events never reached PostHog

- $pageview and $web_vitals were arriving fine; the explicit
  posthog.capture() calls - feedback_submitted (feedback.html),
  signup_link_clicked (analytics.js, site-wide click delegation), and
  submission_form_submitted (submit.html) - had never once appeared in 30+
  days, confirmed against PostHog's own data schema, not just "not seen
  recently." The underlying data (feedback rows, opportunity submissions)
  was landing in Supabase correctly throughout - purely an analytics-
  visibility bug. No separate prior fix existed for any of the three before
  this entry, despite a later message referencing one - checked git log
  and origin/main directly before touching anything; this is the only fix.
- Reproduced directly against production with CDP: injected a fetch/XHR
  wrapper via Page.addScriptToEvaluateOnNewDocument (runs before any page
  script, so it sees exactly what the real SDK sends, not a hand-built
  request), navigated to /feedback, and called
  window.posthog.capture('feedback_submitted', ...) directly from the
  console - same function feedback.html calls, no Supabase row created.
- The request body was an ArrayBuffer starting with 1f 8b 08 - the gzip
  magic number. Neither the JS-visible request headers nor the raw wire
  headers (via Network.requestWillBeSentExtraInfo, i.e. what the browser
  actually sent, before Vercel ever sees it) carried a Content-Encoding
  header, and the URL posthog-js itself constructed
  (/lantern/i/v0/e/, no query string, confirmed at both the JS layer and
  the wire) never got PostHog's ?compression=gzip-js query flag either.
  So: a gzip'd body, with no signal anywhere that it's gzip'd.
- PostHog's ingestion endpoint ACKs 200 {"status":"Ok"} immediately
  regardless - it queues for async processing rather than validating the
  body inline - which is exactly why this was invisible from the browser
  for weeks: the network tab looked completely successful.
- Confirmed the automatic $pageview send (via /lantern/e/, the older
  unbatched endpoint) has the identical unsignaled-gzip body, yet it does
  arrive. The working theory: /e/ sniffs gzip by magic bytes regardless of
  headers; the batched /i/v0/e/ endpoint that request_batching routes
  custom events through does not, and silently drops what it can't parse.
  This matches a known class of PostHog issue (Content-Encoding/gzip
  signal mismatches causing silent ingestion failures - see
  PostHog/posthog-js#261 and PostHog/posthog#4816).
- Checked Vercel's runtime logs for the request window - nothing. Expected:
  /lantern/* is a static rewrite-to-external-destination, handled at
  Vercel's edge/CDN layer, not a function invocation Vercel logs at that
  level. Ruled out as a source of signal, not a dead end that needed
  chasing further.
- Fix: analytics.js now sets disable_compression: true in posthog.init().
  Confirmed in the real array.js bundle Vercel is actually serving (pulled
  directly from /lantern/static/array.js, not assumed from a different
  version) that this flag exists and is the documented way to keep
  posthog-js on its plain application/json fallback path instead of the
  gzip one - sidesteps whatever is failing to attach the compression
  signal in this setup, rather than trying to reproduce that signal
  through a static Vercel rewrite (which can't inject response-dependent
  headers or react to what the SDK negotiates). Costs a small amount of
  bandwidth per event; not something a low-traffic teen-facing directory
  needs to optimize for.
- This is a single posthog.init() config change, not a per-call-site fix -
  every posthog.capture() call in the codebase goes through the same
  shared instance, so it covers feedback_submitted, signup_link_clicked
  and submission_form_submitted identically without touching feedback.html,
  the click delegation in analytics.js, or submit.html individually.
  Confirmed submit.html:579 uses the same window.posthog.capture(...) call
  pattern as the other two before relying on that.
- The proxy itself was never the problem - confirmed the same missing-
  signal body at the wire level, i.e. before Vercel's rewrite touches
  anything. Did not need the planned direct-to-PostHog preview-deployment
  bypass test to establish that; the wire-level evidence already ruled the
  proxy in or out for both endpoints identically.
- Verification still needed from Arjun: this session has no PostHog query
  access (only the client-side capture key baked into analytics.js, which
  can't read data back out), so confirming feedback_submitted and
  signup_link_clicked now actually land in PostHog's data schema needs a
  check from the PostHog dashboard after this deploys - the network tab
  alone is exactly the thing that looked fine for 30 days while this bug
  was live.

## 2026-09-01 — Fixed the loading-counter-shows-0 bug on admin.html

- The three section-header count badges on admin.html (Pending, Published,
  Feedback) were hardcoded to the literal text "0" in the HTML and only
  overwritten once the /api/admin fetch resolved. Every other counter on
  the site (the nav badges right next to these same three, review.html's
  three, index.html's "N opportunities found") starts empty and fills in on
  load - these three were the only ones that looked like a real, wrong
  answer ("0 pending", "0 feedback") for however long the fetch takes,
  rather than simply blank.
- Fix: start them empty like everywhere else. Confirmed with a delayed-
  response test that they read as blank mid-load and the correct number
  once the fetch lands, including the case where the real count actually
  is zero (which should still show "0" once that's confirmed, just not
  before the data arrives).

## 2026-08-31 — Split admin.html into a list page and a review page

- Pending and published listings on admin.html used to render as full cards —
  description, sign-up steps, the approve panel with its map, the whole edit
  form, and (as of the verification gate above) the whole checklist too -
  stacked one after another for every row at once. Fine for one or two
  submissions, unreadable for ten. Requested change: collapse each row to a
  name and a one-line summary, and move everything else to its own page,
  reached by clicking the row.
- New admin-review.html carries that page: reads ?id= from the URL, fetches
  the same /api/admin GET admin.html already used, finds the row in whichever
  of pending/published it's actually in (no separate kind= param needed - the
  id is unique across both, since they're the same table), and renders it
  with buildPendingCard/buildPublishedCard moved over unmodified. Everything
  those two functions depend on moved with them: the edit form, the category
  and schedule pickers, the Leaflet map, and the whole verification block —
  none of it is duplicated in admin.html anymore, it simply isn't there.
- What changes on success now that there's no second list on the same page to
  move a card into: approve/reject/unpublish/delete show their confirmation
  message, then redirect to /admin?view=edit or /admin?view=confirm after
  ~800ms, landing back on the list the row now belongs to. Save (a plain
  update, no status change) still stays on the page and patches the header
  in place, same as before - there's nothing to navigate back to for that
  one.
- Two things caught in local testing before this went out: a genuine session-
  persistence gap (typing the password directly into admin.html's own login
  form never wrote it to sessionStorage - only admin-login.html and review.html
  did - so a row click from that path would have bounced straight back to
  /admin; admin.html's loadAll() now sets it too on success), and
  Loading.clear() only lifts the shimmer class, it doesn't empty the
  container - the skeleton markup was staying mounted underneath the real
  card until innerHTML was cleared explicitly.
- Also fixed in passing, found while touching this code: loadAll() referenced
  a bare `view` where it meant the module-level `VIEW` constant, throwing on
  every successful non-view= load right after the login panel was hidden -
  caught by the surrounding try/catch with nothing visible to show it, so the
  section-nav badges, scroll-spy and the Send digest button silently never
  appeared. Now reads VIEW correctly.
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
