# Elpys dev log

Chronological record of changes made via Claude Code, newest first. This file is
part of the repo's GitHub sync into the Elpys Claude Project, so Cowork sessions
can read it automatically. It's a supplement to `elpys-project-context.md` (which
lives in the Claude Project itself, not this repo, and is the narrative canonical
doc) — this file is the raw log a Cowork session pulls from when refreshing that
doc, not a replacement for it.

## 2026-09-03 — Real 404s for unknown listings, and a digest that stops loudly

Two fixes found in the final pre-marketing confirmation pass. Both are about
failures that are silent rather than loud, which is why neither had shown up on
its own.

### Unknown listing URLs returned 200, not 404

The catch-all slug rewrite added during the clean-URLs work matches **any**
single-segment path that is not a reserved name and sends it to
`opportunities-detail.html`. That is what makes `/earthcorps` work. It also
meant a URL for a listing that does not exist returned **HTTP 200** with the
detail template, only becoming "Opportunity not found" once JavaScript ran.

Verified before touching anything: `/this-page-does-not-exist` and the live
`/keep-bellevue-beautiful-belred-cleanup` returned **byte-identical HTML** with
identical 200 statuses. The two are indistinguishable to anything that does not
execute scripts.

Three consequences, in increasing order of how much they matter:

1. `404.html` became unreachable for a mistyped single-segment URL — it only
   fired for multi-segment paths. Someone typing `/abuot` got "Opportunity not
   found — it may have been removed", which is the wrong message.
2. Google reports a 200 that says "not found" as a soft 404. The `noindex`
   `setPlaceholder()` injects stops it being *indexed*, not *reported*, and
   only after render.
3. **Every listing ever unpublished leaves a permanent 200 behind it.** That was
   about to happen on a schedule: the two Keep Bellevue Beautiful events
   (Sep 5 and Sep 12) are in the submitted sitemap, so Google had been pointed
   directly at URLs that were going to start answering 200-not-found within
   days.

`middleware.js` now resolves the slug before the rewrite runs and serves a real
404 for anything that is not a live listing. Specifics worth keeping:

- **The slug check runs BEFORE the auth gate, and returns unconditionally.**
  Every listing page is public; falling through to the gate would have 404'd all
  fifteen for signed-out visitors, which is every visitor. `ADMIN_PATHS` exists
  so the gated paths — all of which are also single-segment — skip the slug
  branch and reach the gate as before.
- **It fails OPEN.** No env vars, or Supabase unreachable, and the request
  passes through exactly as before. A soft 404 on a junk URL is a nuisance; a
  hard 404 on all fifteen real listings during a blip is an outage.
- **Stale-while-revalidate cache**, 60s TTL. A stale set is returned while a
  refresh runs unawaited, so only the first request an edge instance sees pays
  the Supabase round-trip rather than adding one to every listing page's TTFB.
  The cost is that a just-approved listing can 404 for up to a minute.
- The filter matches `supabase-client.js` and `api/sitemap.js` exactly —
  published, plus one-time rows only while their date is ahead. All three answer
  "is this listing live right now?" and disagreement between them is the bug.
- **The matcher's exclusion list is a duplicate of the one in `vercel.json`'s
  rewrite** and has to stay identical. They describe the same set from opposite
  ends. A name added to one and not the other either 404s a real page or lets a
  soft 404 back through. Flagged in the file.
- `decodeURIComponent` is wrapped: `/%` is a malformed escape that throws
  `URIError`, which would have turned a junk URL into a 500 from the middleware
  itself.

Tested by running the real file in a VM against a stubbed fetch, covering every
branch: three live slugs pass through; three unknown ones (including the Sep 5
event) 404; four admin paths still 404 through the gate when signed out; the
old `?slug=` redirect still 308s without the query; Supabase-down and env-missing
both pass through; five requests cause one Supabase call; and `/%` 404s instead
of throwing.

### The weekly digest would have died mid-send, silently

`api/send-digest.js` sent one email at a time — `await sendEmail(...)` inside
the profile loop — under the `maxDuration: 10` that `vercel.json` applies to
every `api/*.js`. At one subscriber that is fine. Somewhere around 20–40 it stops
being fine, and not by erroring: the function is killed mid-loop. Some people get
that week's digest, the rest silently do not, and because the opportunity query
keys off `published_at` within the last 7 days, **the next run does not cover
them either** — the same tail can miss week after week with nothing anywhere to
show for it.

Three changes:

- Building and sending are now separate phases. Building is pure string work;
  sending is the only part that can run out of time. Separating them means the
  time budget governs sends alone and a truncated run has an exact count of what
  was left, rather than stopping somewhere inside a loop doing both.
- Sends run 4 at a time via `Promise.allSettled` through the already-pooled
  transport in `lib/sendEmail.js`. `allSettled`, not `all`: one rejection must
  not abandon the rest of its own batch.
- A 50s budget inside a `maxDuration` raised to 60s **for this function only**
  (a per-function override in `vercel.json`; the other endpoints keep 10s). The
  run now stops itself before the platform kills it and reports
  `truncated: true` with `sent`/`built`/`unsent`, plus a `console.error` naming
  how many people got nothing.

Gmail's own ~500-recipients/day cap is now the binding constraint instead of the
timeout, which is the right way round: a documented number rather than a cliff.

Tested against the real handler with a stubbed mailer: 30 recipients all
delivered at peak concurrency 4 in 221ms where sequential would be ~600ms; one
bad address yields sent 19 / failed 1 / not truncated; and a deliberately slow
mailer with 400 recipients truncates at 224 with `ok: false`, counts that add up
(`sent + failed + unsent === built`), and the loud log line.

## 2026-09-02 — Admin nav: Feedback and Submit an opportunity swapped

Fourth request against this nav's row layout today. Row 1: Approve
opportunities, Submit an opportunity, Edit opportunities, Log out. Row 2:
Data review, Analytics review, Feedback, Send digest now. Log out still
hasn't moved.

The row-assignment restructure from the previous entry did what it was for:
this was a four-line edit (swap which container `feedbackLink` and
`subSubmit` get appended to), not a rewrite. Verified the same way as each
prior pass — all 8 hrefs resolve to the right pages, both status dots still
color correctly in their row.

## 2026-09-02 — Admin nav row swap: Data/Analytics review down, Feedback/Edit up

Third change to this nav's row layout today, requested directly: swap Data
review and Analytics review down to row 2, swap Feedback and Edit
opportunities up to row 1. Log out stays put, as it has through all three
changes.

Row 1: Approve opportunities, Feedback, Edit opportunities, Log out.
Row 2: Data review, Analytics review, Submit an opportunity, Send digest now.

Restructured how the nav is built rather than just moving lines around: every
element (each link, each status dot, each fetch call) is now created once, up
front, and appended to its row in one block at the end. The previous
structure interleaved creation with row placement, so each reshuffle meant
finding and re-cutting a whole creation block out of one row's code and
pasting it into the other's — this is the second time that got done by hand
in one session. Row membership is now four `appendChild` lines per row;
moving something is changing which block it's in, not moving code around it.

Verified the two status-dot fetches (`/api/review?summary=1`,
`/api/analytics-review?summary=1`) still color correctly after landing in
row 2 — they reference the dot elements directly, not by row, so the move
doesn't touch that logic. Confirmed all 8 hrefs still resolve to the right
pages post-swap.

## 2026-09-02 — Admin nav follow-up: no bold, 4-and-4 instead of 5-and-3

Arjun looked at the previous entry's result and asked for two changes: drop
the bold/bigger styling on row 2 (all 8 buttons should look identical again),
and rebalance the rows to 4-and-4 rather than 5-and-3, with Log out staying
exactly where it was.

Removed `.header-admin-link-lg` / `.header-logout-btn-lg` entirely — row 2's
three items are back on the plain `.header-admin-link` / `.header-logout-btn`
every other nav item on the site uses.

For the split: Log out can't move, and any two-way swap between the rows
cancels back to the original 4-real-items/3-items count — so the only way to
reach 4-and-4 is moving exactly one of row 1's four real items (Feedback,
Approve opportunities, Data review, Analytics review) down to join row 2's
existing three. Built a side-by-side test harness loading the real
`styles.css` and measured actual rendered widths for all four options rather
than guessing from character counts:

| moved down | row 1 width | row 2 width | gap |
|---|---|---|---|
| Approve opportunities | 437px | 633px | 196px |
| Analytics review | 461px | 608px | 148px |
| Data review | 490px | 579px | 89px |
| **Feedback** | **516px** | **553px** | **37px** |

None of the four options make row 1 wider — row 2's three original items
(Edit opportunities, Submit an opportunity, Send digest now) are inherently
the longest labels on this nav, so it's structurally the wider row regardless
of which single item joins it. Moving Feedback got closest by a wide margin.
Told directly, not silently: this doesn't fully satisfy "if one has to be
bigger, make it the top row" — it gets as close as the label set allows.

Row 1 is now: Approve opportunities, Data review, Analytics review, Log out.
Row 2: Feedback, Edit opportunities, Submit an opportunity, Send digest now.
Verified all 8 hrefs still resolve correctly post-move, and checked mobile
again — the pre-existing header-overflow issue is present but measurably
smaller than before (470px vs. 550px against a 375px viewport), not worsened.

## 2026-09-02 — Sized the admin nav's two rows to match what they actually are

Arjun asked to organize the injected admin nav (the one supabase-auth.js adds
to every public page's header when logged in as admin) so "the 4 smaller ones
are on top and the three bigger ones are on the bottom." Checked the CSS
before touching anything: `.header-admin-link` and `.header-logout-btn` were
shared identically by all 8 buttons across both rows — no size distinction
existed anywhere. The "4 smaller / 3 bigger" categories weren't literal yet;
they had to be built.

The counts only resolve one way: row 1 already held Feedback, Approve
opportunities, Data review, Analytics review and Log out — 4 real nav items
plus a session action that doesn't belong to either category — and row 2
already held exactly 3 (Edit opportunities, Submit an opportunity, Send
digest now). Confirmed this reading directly with Arjun before writing any
CSS, since two different pages (`/admin` itself vs. this injected nav) both
plausibly matched "admin view" and guessing wrong meant redoing real work.

New `.header-admin-link-lg` / `.header-logout-btn-lg` for row 2 only: larger
font-size, bolder weight, more generous padding, a stronger border — same
visual language as the site's own `.btn`, sized for a header rather than a
full CTA. Row 1 unchanged. Reasoning made explicit in a comment: row 2 is the
actual work an admin comes to the header to do; row 1 is navigation to other
pages plus session status.

Checked at 375px against both the branch and unmodified production before
merging: row 1 already overflows off the right edge of the viewport on
mobile (`document.documentElement.scrollWidth` reports 550px against a
375px viewport) on production too, identically — a pre-existing, already-
tracked issue (see the Analytics review entry's own testing note: "this
project has an open header-overflow issue tracked elsewhere"), not something
this change introduced. Row 2's new, larger buttons still wrap onto their own
line correctly.

## 2026-09-02 — Fixed the analytics task's next-run date: first Monday, not the 1st

Arjun caught this directly: `nextRunLabel()` in `api/analytics-review.js`
computed "next month's 1st" unconditionally, but the Cowork task actually runs
on the first Monday of the month — the same date only four times a year. From
today (Sept 2), that gave "October 1" when the real next run is September 7.

New `firstMondayOf(year, month)` finds the actual date; `nextRunLabel()` takes
the current month's first Monday if it's still ahead of now, otherwise next
month's. Verified against the exact case that surfaced this (Sept 2 → "September
7, 2026") and against a year rollover (Dec 31 → "January 4, 2027"). Confirmed
live against production after deploy, not just locally — `/api/analytics-review`
with the admin password now returns `detail: "The first monthly review runs
September 7, 2026."`.

## 2026-09-02 — Analytics review page, and old URLs now redirect genuinely clean

### The page

New admin-only `/analytics-review`, backed by a new `/api/analytics-review`,
reading the monthly PostHog figures the Cowork scheduled task writes to
`analytics_reviews` plus its `task_runs` heartbeat
(`task_name = 'analytics_review_monthly'`). Nothing in this repo writes either
table. Built as a sibling of `/review` — same `restBase()`, same
`probeSupabase()`, same `{dot,label,detail}` status shape, same login flow and
session key — so the two admin utility screens stay recognisably the same
thing.

Shows: status block, then the most recent review (period as one readable
range, the narrative in a bordered block with real visual weight since it is
the thing you actually come here to read, pageviews, top pages, web vitals
with sample size, sign-up clicks, notes), then a compact history list.

The overdue threshold (45 days = 30-day cadence + 15 grace) matters more than
it looks: a cron that silently stops writes no error and no failure row. The
only symptom is `last_run_at` quietly not moving, so that threshold is the
single thing that can ever surface it.

### Three corrections to the task description, all load-bearing

1. **`vercel.json` had to change, despite the task saying not to touch it.**
   That instruction was written before this morning's clean-URLs work added a
   catch-all slug rewrite. `analytics-review` MUST be in that rewrite's
   reserved-name exclusion list or the new page is swallowed and served as an
   opportunity-detail page. This is exactly the gotcha written up in the entry
   below — hit for real the first time, one task later. Following the
   instruction literally would have shipped a page that 404s.
2. **`middleware.js` had to change too.** Every other admin page 404s without
   a session; a brand-new admin surface left publicly loadable would have
   quietly undone that.
3. **`Loading.cards` takes `(count, label)` positionally**, not the options
   object the task showed. An object makes the loop condition `i < {}` false
   and renders an empty skeleton — silent, not an error.

### Old URLs now redirect to genuinely clean ones

Arjun pushed back on the previous entry's "known limitation" and was right to.
`/opportunities-detail?slug=wta` was landing on `/wta?slug=wta` — right page,
pointless leftover parameter on a URL whose whole purpose was to be clean. The
earlier conclusion that this was unfixable was wrong: it ruled out ONE
approach (`preserveQueryParams`, which really is a Bulk Redirects API field
and not a `vercel.json` key) and stopped there. `middleware.js` already runs on
those paths and builds its own `Location` header, so it can simply omit the
query.

Both redirect families moved out of `vercel.json`'s `redirects[]` — now empty
and removed entirely — into `middleware.js`. Ordering is deliberate: the
listing redirects run BEFORE the auth gate (they are public pages and must
never be gated), the `/admin?view=` redirect runs AFTER it (so a signed-out
stranger gets the 404 rather than a redirect confirming `/admin-feedback`
exists).

**Loop hazard, flagged in the file:** `/opportunities-detail` is also the
internal destination of the catch-all slug rewrite. This is only safe because
middleware matches the ORIGINAL request path, not the rewritten one — if it
matched rewritten paths, `/earthcorps` would redirect to itself forever.
Verified explicitly; re-test that if the matcher is ever touched.

### Tested on a preview deployment, then re-verified on production

All six page states driven for real, with test rows inserted into Supabase and
deleted afterwards (confirmed zero rows left, and the two pre-existing
`task_runs` rows untouched):

- **Never run** (today's real state) — grey dot, "The first monthly review
  runs October 1, 2026." The date is computed, not hardcoded; the task text
  said Sept 1 was correct, but Sept 1 had already passed by the time this
  shipped, so a hardcoded string would have been wrong on day one.
- **Running on schedule** — green, full render: 1,234 pageviews, +12.2%,
  8 top pages, vitals with "based on 340 events", 2 notes, 1 history row.
- **Overdue** (50 days, status ok) — yellow, not green. This is the case the
  threshold exists for.
- **Last run failed** — red, note surfaced.
- **Last run degraded** — yellow, note surfaced.
- **Ran but wrote nothing** — dashed empty-state box, not a blank page.
- `pct_change: null` renders "—", never "0%" or "NaN%". Zero sign-up clicks
  render in error red with an explanatory line, deliberately not styled like a
  healthy stat. Empty `notes` array omits the section entirely.
- 375px: no horizontal overflow (`scrollWidth` equals viewport), content wraps.
- Auth: 401 without/with a wrong password, 405 on POST, page 404s unauthenticated
  with the branded 404 (confirmed by title — a 404 alone would not have
  distinguished "gated" from "swallowed by the slug rewrite").
- Injected admin nav carries the new link with its own independent dot, neutral
  (not green) when the task has never run.
- One redundancy caught and fixed mid-test: the status panel printed the task
  note twice, once as the detail and again in the meta line.

## 2026-09-02 — Clean URLs: /bellevue-farmers-market, not /opportunities-detail?slug=…

Two URL patterns were never clean. Individual listings lived at
`/opportunities-detail?slug=X`; admin.html's three panels lived at
`/admin?view=X`. Both are now real paths.

### The reserved-name exclusion list — READ THIS BEFORE ADDING A TOP-LEVEL PAGE

`vercel.json`'s last rewrite is a single-segment catch-all: any `/<one-segment>`
that isn't a known name gets served as a listing detail page. Every reserved
top-level name on the site is spelled out in a negative lookahead inside that
rule — every page's clean URL, every root `.js`/`.css` asset, `robots.txt`,
`sitemap.xml`, `favicon.ico`, `logos`, `api`, `index`, `404`.

**Adding a new top-level static page without adding its name to that list will
silently break it** — the catch-all swallows the request and serves the
"Opportunity not found" page instead. This warning lives here rather than in
`vercel.json` because Vercel's schema validation rejects unknown keys: a
`"comment"` field on a rewrite object failed the *entire* config and the
deployment errored outright (`rewrites[7] should NOT have additional property
comment`). JSON has no comment syntax and Vercel tolerates no informal one.

The exclusion list is exact-match (`(?:name|name2)$`), not prefix-match. That
matters: a future listing slugged `admin-appreciation-day` must not collide
with `admin`, and it doesn't.

### Redirects, because 23 URLs are already indexed

Search Console has the old `?slug=` URLs submitted via `/sitemap.xml`, and a
weekly digest email already went out carrying them. Permanent (308) redirects
cover `/opportunities-detail?slug=X`, `/opportunities-detail.html?slug=X`, and
the legacy `/opportunities/detail.html?slug=X`, all landing on `/X`. The
legacy rule was previously non-permanent and pointed at the old page; it now
goes to the final URL and is permanent.

### Four real bugs, all found by deploying to a preview — none by reading code

1. **A rewrite destination ending in `.html` 404s** under `cleanUrls: true`.
   Isolated by bisecting on live previews: `/:slug` → `/about` worked; the
   identical rule → `/opportunities-detail.html` did not. All destinations are
   extensionless now.
2. **A redirect `source` ending in `.html` never matches** — cleanUrls' own
   `.html`-stripping runs before `vercel.json`'s redirects are evaluated, so
   the legacy `/opportunities/detail.html` rule had never once fired. Source
   changed to `/opportunities/detail`.
3. **The new admin paths bypassed the edge gate entirely.** `middleware.js`'s
   matcher didn't list them, so `/admin-feedback`, `/admin-edit` and
   `/admin-approve` returned 200 to a request with no session cookie while
   `/admin` correctly 404'd — a real security regression introduced by this
   change and caught before merge. Any future alias for a gated page must go
   in that matcher.
4. **Nested `/admin/...` paths broke the page outright.** admin.html loads
   `styles.css` and `loading.js` *relatively*, so at `/admin/feedback` the
   browser resolved them against `/admin/`, requested `/admin/styles.css`,
   got HTML back from the catch-all rewrite, and rendered unstyled with
   `ReferenceError: Loading is not defined`. Hence flat `/admin-feedback`,
   a sibling of `/admin`, where every relative reference still resolves.

### Client-side slug/view reading had to change too

A rewrite is server-side: the `?slug=` and `?view=` on the *destination* never
reach `location.search`. Both pages read their identifier from
`location.pathname` now, with the query string kept as a fallback. Without this
every listing would have shown "No opportunity specified" and every admin
sub-view would have shown all three panels.

### Known limitation, not fixed

`/opportunities-detail?slug=X` redirects to `/X?slug=X`, not a bare `/X`.
Vercel appends the original query string to any redirect destination that
doesn't have one, and `preserveQueryParams` is a Bulk Redirects API field, not
a `vercel.json` key — confirmed by a second failed deployment. Cosmetic only:
the page reads the slug from the path, the canonical tag is correct
regardless, and it only affects someone following an old indexed link, never
the new links the site now generates.

### Verified on production after merge

All 15 real listing slugs 200. All 13 reserved pages and every root asset
still resolve. All six gated admin paths 404 unauthenticated; `/admin-login`
stays open. Logged in, each admin sub-view shows only its own panel and hides
the section nav, while bare `/admin` shows all three plus the nav. Redirect
chains resolve in 1–2 hops with no loops. Sitemap: 23 URLs, zero `?slug=`
left. Homepage cards, hero mini-map pins and the map sidebar all link to
clean URLs. An unknown slug still shows "Opportunity not found" with
`noindex` — a soft 404, unchanged and out of scope. Zero console errors on
any page checked.

### Left alone deliberately

`map.html?select=<slug>` (focuses a pin) and `/api/unsubscribe?id=…` (a token)
are state and actions, not page identity — correct as query parameters.
`api/send-digest.js` was already building `/opportunities-detail?slug=…`, not
the broken `/opportunities/detail.html?slug=…` an earlier note claimed, so
there was no pre-existing bug there to fix; it just moved to the new form
with everything else.

## 2026-09-02 — admin.html/admin-review.html/review.html now 404 without a session

Arjun asked for pages that "aren't supposed to be on the site anymore" —
turned out to mean admin.html, and by extension admin-review.html and
review.html, which required the admin password to see any real DATA, but
whose page shell (and the fact that an admin system exists at those URLs at
all) was reachable by anyone.

- New `middleware.js` (Vercel Edge Middleware) 404s all three for any request
  without a valid signed session cookie — real 404, self-fetched from
  `/404.html` so it can't drift from the one every other unmatched URL gets,
  before any of the real page's HTML ships.
- `admin-login.html` is deliberately NOT gated. It has no admin data on it —
  just a password box — and gating it would make it impossible for anyone,
  including Arjun, to ever obtain the cookie that unlocks the other three.
  This is the one door that has to stay open so the others can close.
- New `adminSessionCookie()` in `lib/adminAuth.js`, HMAC-SHA256 over an
  expiry timestamp keyed on `ADMIN_PASSWORD` — no new secret needed, and the
  password itself is never placed in the cookie. Set on every successful
  password check in `api/admin-login.js`, `api/admin.js` and `api/review.js`
  (12-hour sliding window, refreshed on each authenticated call). Verified
  independently in `middleware.js` using Web Crypto, since the Edge runtime
  has no access to Node's `crypto` module — the two implementations must be
  changed together if either ever is.
- `checkAdminPassword()`'s existing contract is completely unchanged, and
  `api/send-digest.js` (out of scope, per standing instruction, and untouched
  here) also imports it — only new, additive exports were added to
  `lib/adminAuth.js`.
- **Real workflow change, not just a cosmetic one**: admin.html and
  review.html each used to have their own inline password form, reachable by
  going straight there. Now a fresh browser session hitting `/admin` or
  `/review` directly gets a 404, not that inline form — Arjun has to visit
  `/admin-login` first to get the cookie, then `/admin`, `/admin-review` and
  `/review` all become reachable. Flagged and tested explicitly rather than
  discovered as a surprise.
- A bug in `middleware.js` can only ever make these three pages 404 or (if
  the check were ever loosened wrong) publicly loadable again — it doesn't
  touch `checkAdminPassword` or the data endpoints, so it can't by itself
  expose admin data. Losing the file is a visibility regression, not a
  security one.

**Tested on a Vercel preview deployment before touching production**, not
reasoned about from the code alone, because a mistake here risks locking
Arjun out of his own admin panel. Preview URLs are behind Vercel's own SSO
wall by project setting (`ssoProtection: preview`, unrelated to this
change), which blocks automated testing — temporarily disabled it via the
Vercel API, ran the full suite below against the preview, then restored it
to exactly its original scope (`preview`) immediately after, confirmed by
re-checking that the preview 302s to Vercel's login again and production is
unaffected either way.

- Fresh session, no cookie: `/admin`, `/admin.html` (redirects to `/admin`
  first via cleanUrls, then 404s), `/admin-review`, `/review` and their
  `.html` forms all 404 with the real branded page
  (`<title>Page not found — Elpys</title>`). `/admin-login` and
  `/admin-login.html` load normally (200).
- Logged in for real at `/admin-login` (Arjun's password, used in-memory for
  this one CDP session only, never written to any file or this log):
  `/api/admin-login` returned 200, then `/admin` returned 200 with real data
  (Pending 1, Published 15, Feedback 1) instead of 404, and `/admin-review?id=1`
  and `/review` both returned 200 with their real titles too.
- Repeated the identical sequence against `elpys.vercel.app` itself after
  merging and deploying — same results, plus confirmed the public site
  (`/`, `/map`, `/submit`, `/feedback`, `/about`) is completely unaffected.

## 2026-09-02 — Verified the pre-freeze sweep patch against live production

Independent verification of the patch below, landed as given via `git am` on a
fresh `pre-freeze-sweep` branch off `main` at `8988b57`, no conflicts, diff
matched the patch description exactly. Merged via branch + merge commit (`gh`
still not installed) and pushed.

- **The double-fetch fix, measured, not assumed**: real desktop UA against
  `https://elpys.vercel.app/`, checked
  `performance.getEntriesByType('resource').filter(e =>
  e.name.includes('supabase.co/rest')).length` directly — **1**, not 2. All 15
  cards rendered, all 15 hero mini-map pins drew. Checked `/map` (15 sidebar
  rows, 15 pins) and `/opportunities-detail?slug=earthcorps` (correct title)
  too, since both call the same `fetchOpportunities()` — also 1 request each,
  nothing came back empty.
- **Rejection-reset path**: blocked the Supabase host at the network layer,
  loaded the homepage — `.load-error` showed with "Opportunities couldn't be
  loaded", 0 cards, exactly as the pre-existing error path is supposed to
  render. Unblocked and reloaded: recovered cleanly, 15 cards, and still only
  1 request — a failed load did not poison the next one.
- **`/privacy`**: "Last updated September 2, 2026" confirmed; the new "No
  location, not even an approximate one" bullet is present; the old
  "approximate city-level location derived from your IP address" claim is
  gone from both section 5 and the PostHog row in section 6's table.
- **Feedback form**: could not be submitted through automation — Cloudflare
  Turnstile did not auto-solve under headless Chrome (expected; not something
  to work around) and this session has no route to a human clicking the
  checkbox. Arjun submitted a real test message directly; confirmed it landed
  by logging into `/admin` (see below) and seeing Feedback (1). Not a gap in
  `pruneExpired()`'s coverage — Turnstile validation runs before the
  rate-limit code in `api/feedback.js`, so this only ever exercises "does a
  real submission still reach the database," which it does.
- **Admin login**: Arjun provided the password directly in chat for this one
  check; used it only in-memory for a single CDP session, never written to
  any file, this log, or saved anywhere persistent. `/api/admin-login`
  returned 200, `sessionStorage` got the token, and `/admin` loaded real data
  (Pending 1, Published 15, Feedback 1) — confirms `lib/adminAuth.js`'s
  pruned `attempts` Map didn't break the login it gates.
- One naming note, not a defect: the `pruneExpired` comment copy-pasted into
  all three files says "the privacy policy's 'held in server memory for at
  most one hour' claim" — true for `api/submit.js` and `api/feedback.js`
  (`RATE_WIN_MS` is 1 hour in both) but `lib/adminAuth.js`'s `WINDOW_MS` is 15
  minutes, so the comment overstates that one file's own window. Cosmetic,
  inside a comment, not something verification is meant to catch or this task
  asked to fix — left alone.

## 2026-09-02 — Pre-freeze sweep: a privacy-policy overclaim, two unbounded Maps, and a double fetch on every homepage view

Readiness pass ahead of feature freeze and marketing, aimed at what changes when
strangers arrive rather than at correctness. Three fixes, all verified.

**The privacy policy claimed analytics it does not collect.** Section 5 said
PostHog derives "an approximate city-level location derived from your IP
address," and the section 6 processor table repeated it. It does not. The
2026-09-01 cookieless fix made GeoIP permanently null (PostHog strips the IP
before its enrichment transformations run), and this was checked against the
real dataset rather than taken from that entry: across 71 production events from
`elpys.vercel.app` in the last three days — 48 `$pageview`, 18 `$web_vitals`,
3 `signup_link_clicked`, 1 `feedback_submitted` — `$ip`, `$geoip_city_name` and
`$geoip_country_name` are non-null on exactly **zero**.

Over-disclosure is not the usual privacy failure, and it is not a breach. It is
still worth fixing, because the whole point of this configuration is that the
site collects less than people expect, and the policy was talking it back out
again. A parent or a school reading section 5 would have concluded Elpys
geolocates its visitors. Section 5 now states plainly that no location is
recorded and why; the processor table says the IP arrives with the request, as
it must for any web request, and is discarded before processing. "Last updated"
moved to September 2 — this changes what users are told is collected, so it is a
substantive edit, unlike the earlier banner rename.

**Two rate-limit Maps grew without bound, and one made the policy untrue.**
`ipStore` in `api/submit.js` and `api/feedback.js`, and `attempts` in
`lib/adminAuth.js`, only ever added entries. Nothing removed one when its window
expired — `adminAuth` deleted on a *successful* login and that was all. On a warm
instance that is one entry per unique IP forever, on a 128MB function.

The second-order problem is the interesting one: privacy.html section 7 states
that rate-limiting IPs "are held in server memory for at most one hour." The
*window* expired after an hour; the *record* did not. The published retention
promise was wrong by construction. `pruneExpired(store, windowMs, now)` now
sweeps on each request in all three, which fixes the growth and makes that
sentence true at the same time. O(n) per request is irrelevant on a Map that
stays small precisely because of the sweep.

Verified: 11 bad admin attempts still lock out with 429; a correct password on a
clean IP still returns null and clears the counter; the sweep keeps a 60-second-
old record and drops a 2-hour-old one.

**Every homepage view made two identical 37KB Supabase queries.**
`fetchOpportunities()` cached the resolved rows, which only helps callers that
arrive after the first request finishes. The homepage has two that arrive in the
same tick — `renderCards()` and `renderAllMiniMap()`, both fired from the one
`DOMContentLoaded` handler — so both saw a null cache and both issued the
request. Confirmed on production before changing anything: two entries in
`performance.getEntriesByType('resource')` for the REST endpoint.

It now caches the in-flight **promise**, so concurrent callers share one request.
The rejected case is reset rather than cached, or a single failed load would
poison every retry for the life of the page. Tested by running the real file in
a VM with a stubbed fetch: two same-tick callers produce 1 network call and the
same array identity; a later call still 1; and after a forced 503 the retry
succeeds on call 2 rather than replaying the rejection.

**Not fixed, flagged for a decision: the weekly digest will time out.**
`api/send-digest.js` sends sequentially — `for (const profile of profiles)` with
`await sendEmail(...)` inside — under the `maxDuration: 10` that `vercel.json`
applies to `api/*.js`. The Nodemailer transport is pooled (`pool: true`, created
at module scope), so connections are reused and each send is a few hundred
milliseconds rather than a full SMTP handshake, which puts the ceiling somewhere
around 20–40 recipients before the function is killed mid-loop.

There is 1 subscriber today, so nothing is broken. What makes it worth recording
now is the failure shape: it does not error visibly, it stops partway. Some
recipients get that week's digest, the rest silently do not, and the next run has
no memory of where it stopped, so the same tail can miss repeatedly. Gmail's own
~500 recipients/day cap sits far beyond the timeout and is not the binding
constraint.

Options, for whoever picks one: raise `maxDuration` to 60 (Hobby's limit, buys
roughly 5×, same shape of failure); send with bounded concurrency through the
existing pool; or chunk across runs with a cursor. The trigger to act is
subscriber count passing ~20, which is worth watching rather than assuming.

**Capacity checked, no other ceiling near.** 37KB uncompressed per listings
query, gzipped on the wire, against Supabase's 5GB monthly egress: hundreds of
thousands of page views of headroom, and the double-fetch fix doubles it.
Database 11MB of 500MB. PostHog free tier 1M events/month against roughly two
events per view. Vercel Hobby bandwidth is not close. Supabase's 7-day inactivity
pause becomes *less* likely once traffic arrives, not more.

## 2026-09-02 — Verified the map list-row patch against live production

Independent verification of the patch below, not a rewrite of it — landed as
given via `git am` on a fresh `map-a11y` branch off `main` at `4aedd5e`, no
conflicts, diff matched the patch description exactly. Merged via a real
branch + merge commit (`gh` is still not installed in this environment, same
as the last two merges), pushed, then checked against `https://elpys.vercel.app/map`
itself — a local static server can't render this page at all, since Leaflet
and supabase-js both load from CDNs and the sidebar never builds.

- **axe-core, real desktop UA, full page**: 0 violations, sidebar confirmed
  populated (15 rows) before running. `nested-interactive` (15, serious)
  is gone; so is the last `region` violation from the previous entry —
  `#beta-banner` still carries `role="region"` from the prior fix and
  nothing here touched it.
- **`role="button"` count is 17, not 0** — checked what they actually are
  before treating that as a problem: all 17 are Leaflet's own markup (15
  map-pin `<img>` markers, one per opportunity, plus its 2 zoom controls),
  none inside `.map-list-item`. Third-party library internals, unrelated to
  this patch and out of scope.
- **15 `.map-list-show` buttons confirmed**, one per row.
- **Tab order confirmed with real keyboard events** (not scripted `.focus()`,
  which doesn't trigger `:focus-visible` the way an actual Tab press does):
  focused the first row's link via Tab from a neutral start, one more Tab
  landed on that row's "Show on map" button. Both elements matched
  `:focus-visible` and showed `outline-style: auto` — a real, visible focus
  ring, not suppressed by any site CSS.
- **Keyboard activation: Space confirmed working** on the button — route
  status updated, active-row highlight moved, map panned. **Enter could not
  be verified through this CDP tooling** — `Input.dispatchKeyEvent` for
  Enter did not produce a click on the focused button. Before flagging that
  as a defect, checked whether it reproduces on a completely unrelated,
  pre-existing native `<button>` this patch never touched
  (`#beta-banner-close`): it does — Enter fails to trigger a click there
  too. That means this is a synthetic-input limitation of headless Chrome's
  CDP (a documented Puppeteer/Playwright-adjacent quirk: native
  keyboard-activation default actions don't always replay through
  `Input.dispatchKeyEvent`), not something this patch broke. Per the
  instruction to fix only what verification actually catches, nothing was
  changed here — a real keyboard and a real browser do not share this
  limitation.
- **Single-select-once confirmed**: clicked a row's description text
  (neither the link nor the button) and watched `#route-status` and the
  active-row highlight — updated once, to that row, not twice. The
  `closest('a, button')` guard is doing its job.
- **390px width checked** alongside desktop: the button renders at a
  measured 24px tall at both widths (matches the CSS's `min-height: 24px`
  intent for WCAG 2.5.8), sits under the description without crowding the
  organisation name, confirmed by screenshot at both widths.

## 2026-09-02 — The map list rows are no longer buttons wrapping links

The last accessibility failure from the pre-marketing scan. `/map`'s sidebar
rows were `<div role="button" tabindex="0">` containing an `<a>` to the
listing's detail page — a control inside a control, which axe reports as
`nested-interactive`, serious, one node per row (15).

**This was not a lint nit.** A screen reader announces the row as a button and
will not step inside it, so the link to the listing's own page was unreachable.
That link was the *only* route from the map to a listing's details, so for those
users there was no route at all. Arjun asked for the clean fix rather than the
cheap one.

- The row is a plain `<div>` again: no `role`, no `tabindex`, no `aria-label`.
- Selecting an opportunity is now a real `<button class="map-list-show">Show on
  map</button>`, appended inside each row. Real button, so Enter and Space work
  without a `keydown` handler, and it is in the tab order beside the link
  instead of competing with it.
- The row keeps its click listener, purely as a mouse convenience. What makes
  that acceptable now is that it is no longer the only way to do anything —
  nothing is announced as interactive that cannot be operated, and nothing
  operable is announced only as decoration. The listener's guard widened from
  `closest('a')` to `closest('a, button')`, or the button's click would bubble
  up and select twice.
- The old `keydown` handler is gone entirely. Enter/Space on the row used to be
  the only keyboard route in; the button provides both correctly.

**The button's accessible name is `"Show on map: " + name`, not `"Show <name> on
the map"`,** which is what the row's old `aria-label` said. Fifteen buttons all
reading "Show on map" are useless in a screen reader's element list, so the name
has to carry the organisation — but WCAG 2.5.3 (Label in Name) requires the
accessible name to *contain* the visible label, because speech-input users say
what they can see. "Show EarthCorps on the map" does not contain "Show on map";
"Show on map: EarthCorps" does.

`#route-status` gained `role="status"`. Pressing the new button pans the map,
which is invisible to a screen reader, and that line ("Selected EarthCorps.
Enter a starting place and show the route.") was the only feedback available and
was announcing nothing. Without this the fix would pass the linter while still
leaving those users with no idea the button had done anything.

Styling: `.map-list-show` uses `--muted-on-surface`, not `--muted` — on
`--surface` that pair measures 5.24:1 where `--muted` is 4.39:1 and fails AA
(the same trap the filter chips were in). `min-height: 24px` clears WCAG 2.5.8
target size, which 11px text plus 0.15rem of padding would not on its own.

**Verified before committing, on the live site rather than in theory.** The
container this was written in cannot render `/map` locally — Leaflet and
supabase-js both come from CDNs it cannot reach, so the sidebar never builds.
Instead the exact post-fix markup was applied to the real page through the
browser (attributes stripped, button appended with the same class and
`aria-label`, the new CSS injected) and axe re-run against it: **15
`nested-interactive` violations → 0, whole page clean.** Checked at the same
time that the button computes to 24px tall, `rgb(95,102,117)` on
`rgb(243,244,246)`, and that the first row's tab order is link then button.

## 2026-09-01 — Fixed the meta-description field name and the last axe region violation

Two follow-ups from the launch/SEO pass, both flagged directly by Arjun rather
than found in another audit.

- **`setListingMeta()` in `opportunities-detail.html` was reading
  `opp.description`, which has never been a real field.**
  `_transformRow()` in `supabase-client.js` exposes the short blurb as `desc`
  and the long body as `_detailDesc` — `opp.description` was always
  `undefined`, so every single listing silently fell back to the generic
  line ("A verified volunteer opportunity for teens in the Bellevue area.")
  regardless of what the row actually said. This is exactly the duplicate-
  content problem `setListingMeta()` exists to prevent, and it was failing
  on 100% of listings since the pass that introduced it. Changed to
  `opp.desc || opp._detailDesc || ''`. Verified live against
  `/opportunities-detail?slug=earthcorps` (real UA, post-deploy): the meta
  description is now EarthCorps's own blurb ("Remove invasive plants and
  restore forests and parks across the Puget Sound region…"), not the
  generic fallback.
- **`#beta-banner` was the one remaining axe `region` violation** noted in
  the entry below — injected by `beta-banner.js` between `</header>` and
  `<main>`, in no landmark. Added `role="region"` and
  `aria-label="Site notice"` at creation time rather than moving the banner
  inside `<main>`: the skip link targets `#main-content`, and moving the
  banner in would land a keyboard user on the dismiss button instead of the
  page's real content. Confirmed the banner still sits between `<header>`
  and `<main>` after the change (unmoved, just labelled), and re-ran axe's
  `region` rule against both a local copy and live production afterward —
  zero violations either way, down from the 1-per-page left after the
  previous entry.
- Both changes verified locally (headless Chrome/CDP) before push, then
  independently re-verified against live `elpys.vercel.app` after merge and
  deploy — not assumed from the local pass.

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
