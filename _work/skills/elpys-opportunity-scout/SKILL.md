---
name: "elpys-opportunity-scout"
description: Find and verify new teen volunteer opportunities for Elpys within roughly a 20-minute radius of a specified location, applying Elpys's full listing criteria (no adult required on-site, clear completable signup, free, open to teens) and producing both a research report and ready-to-paste database rows. Use this whenever the user asks to find, source, scout, research, or expand into new volunteer opportunities, orgs, or listings for a city or neighborhood — including phrasings like "what else could we list in Kirkland", "expand to Redmond", "find 10 more orgs near Sammamish", "who should I email this month", or any request to grow the Elpys directory in a new area. Also use when the user wants an existing candidate org checked against the Elpys criteria. Carries the Aug 2026 organization-accountability gate and the Oct 2026 findability rule.
---

# Elpys Opportunity Scout

Find volunteer opportunities that a teen can actually sign up for and show up to,
within ~20 minutes of a given location, and verify them well enough that they can be
listed on Elpys without a follow-up correction.

Elpys exists because the KCLS list it replaced was full of homepage links, stale
programs, and buried age rules. Every shortcut taken here reintroduces exactly the
problem the site was built to solve — so the standard of proof matters more than the
number of candidates found. **Ten verified listings beat forty plausible ones.**

## The four things that make this skill useful

1. **The organization gate comes first.** Before any question about whether an
   *opportunity* suits a teen, the *organization* has to be a government body or a
   registered charity in good standing. This is Step 3b, it is not negotiable, and it
   is the check that stops a fabricated or impersonated org reaching a teen.
2. **The criteria are strict and non-obvious.** Most volunteer orgs fail them, usually
   on friction rather than on principle. Read `references/criteria.md` before judging
   any candidate — it holds the full criteria, the disqualifiers observed in practice,
   and the accuracy corrections already paid for once.
3. **Verification is against live pages, never search snippets.** A stale snippet once
   caused a correct Sophia Way signup link to be "fixed" into a wrong one. Fetch the
   org's actual volunteer page and read it.
4. **A signup a teen can't navigate is a reject. A merely missing fact is not.** Added
   Oct 2026, narrowed the same day. Never draft an email to fill a gap. If the gap stops a
   teen reaching a claimed spot at all — no readable contact, no venue, no registration
   path — reject it. If signup is one frictionless click and only some field Elpys wanted
   is unpublished, keep the listing and state the gap on the card. See the findability
   rule in Step 5.

---

## Workflow

Work through these in order. Steps 1–3 are cheap and prevent wasted verification
effort; don't skip ahead to searching.

### Step 1 — Establish the search frame

The user names an anchor (a city, a neighborhood, an address, a ZIP). Convert it into
a concrete geographic frame before searching, because "20 minutes" is not a search
term — place names are.

Produce, and state to the user:

- **Anchor**: the exact place the radius is measured from. If the user said only a city
  name, use its civic center or downtown core and say which point you used.
- **Inner ring** — places reliably within ~10 minutes' drive.
- **Outer ring** — places at roughly 10–20 minutes.
- **Excluded but nearby** — places just outside the radius, listed explicitly so the
  user can see what was consciously left out.

As a working rule, 20 minutes of suburban Eastside driving is roughly 8–12 miles;
freeway-connected places stretch further, and anything crossing a bridge, a lake, or
downtown Seattle traffic is much shorter in miles than the map suggests. Where a
candidate sits near the boundary, verify rather than assume: fetch a routing estimate
if a tool is available, and otherwise flag it as borderline in the report rather than
quietly including it.

Teens frequently can't drive. Where a candidate is at the outer edge, note whether it
sits on a direct bus route from the anchor — this is often the difference between a
listing that gets used and one that doesn't.

### Step 2 — Load what already exists

Don't research an org that's already listed, already rejected, or already emailed.

If a Supabase connector is available, read the current listings:

```sql
SELECT id, name, website, address, status, opportunity_type, event_date FROM "Opportunities" ORDER BY name;
```

The table name is `"Opportunities"` with a capital O and must stay double-quoted —
unquoted identifiers get lowercased and the query fails. If no connector is available,
ask the user to paste an export rather than guessing at the contents.

`opportunity_type`/`event_date` (added Aug 2026) distinguish a recurring listing from a
one-time one — see the "Episodic vs. ongoing" judgment call below for how to set these
on new rows. Pulling them here matters for dedup too: a `one_time` row whose `event_date`
has already passed is done, not a listing to avoid re-proposing for a *future* instance
of the same event — a recurring annual event's next occurrence is a fresh candidate, not
a duplicate.

Then read the **explicitly rejected** list and the **previously removed for distance**
list in `references/criteria.md`. Re-proposing Boys & Girls Club or Seattle Humane
without acknowledging why they were rejected wastes the user's time and signals the
criteria weren't read.

### Step 3 — Build a candidate list

Cast wide here; the filtering happens later. `references/sourcing.md` lists the source
types that have actually produced listings, in rough order of yield, along with search
patterns that work. Aim for roughly 3–4× as many candidates as the user wants final
listings, because the pass rate against these criteria is genuinely low.

Record for each candidate only what's needed to decide whether to verify it: name,
what they do, rough location, and the URL you'll check.

### Step 3b — Clear the organization gate

Added Aug 2026 after a legal review. Do this **before** spending any effort verifying
ages, schedules or signup steps: it is cheap, it is objective, and it disqualifies
faster than the criteria do.

Elpys cannot verify that an organization is *safe*, and must never imply that it has.
What it can verify is that an organization is **real, registered, and accountable to
someone other than itself**. That is the whole of the gate, and the site says so
publicly on `/how-we-check` — keep the report's language consistent with that page.

**Every candidate must fall into one of exactly two tiers. There is no third tier.**

- **Tier A — government or public body.** A city, county or state department, a school
  district, a public library. Confirm the program is described on the body's own
  official site (`.gov`, `.k12.wa.us`, or a district/library domain). Records the row
  as `org_tier: government`. Most current Elpys listings are Tier A.
- **Tier B — registered charity.** All four of these must check out, each with a URL
  cited in the report:
  1. **IRS Tax Exempt Organization Search** — current 501(c)(3), and *not* on the
     automatic-revocation list. Record the EIN.
  2. **WA Secretary of State Charities Program** (`ccfs.sos.wa.gov`) — registered under
     the Charitable Solicitations Act, ch. 19.09 RCW, and **active**, not delinquent or
     expired. Record the registration/UBI number.
  3. **At least one Form 990 on file** — ProPublica Nonprofit Explorer is the fastest
     read and has a free API.
  4. **An established footprint** — a website that has existed for more than about two
     years, at an address consistent with the state registration.
  Records the row as `org_tier: charity`.
- **Anything else — REJECT.** An unregistered group, a brand-new organization, a
  fiscally sponsored project with no independent record, an individual person. No
  exceptions, however good the opportunity looks. Say in the report which of the four
  checks failed, so the user can re-check in a year.

**Categorical exclusions — reject on sight, no judgment call:**

- An individual person rather than an organization.
- Any opportunity hosted at a private residence.
- Any opportunity where a teen would be one-on-one with an adult rather than part of a
  group at an organizational or public facility.
- Any listing whose only contact route is a personal email (gmail, outlook, yahoo) or a
  personal mobile number rather than an organizational or `.gov` address.
- Any listing whose signup link does not live on the organization's own domain or on a
  recognised volunteer platform the org's own site links to.

**Record these on every PASS row** so the weekly data check can re-verify them later:
`org_tier`, `org_legal_name` (the registered name, often not the trading name), `ein`,
`wa_charity_number`, and `org_domain` (the canonical registrable domain, e.g.
`earthcorps.org` — the weekly check compares signup links against it, because an
expired domain that someone else re-registers is the quiet failure mode).

### Step 4 — Verify each candidate against live sources

For each candidate, fetch the organization's own volunteer page. Not a directory
listing, not a search result summary, not a cached description — their page. Where the
signup runs through a portal (Bloomerang, VolunteerHub, Golden, SignUpGenius), fetch the
portal URL too and confirm it resolves to a real form.

Extract, and record the source URL for each:

- Minimum age, and whether it differs for solo vs. accompanied volunteers
- Whether an adult must be **present on-site** (the single most common disqualifier)
- The exact signup path, step by step, as a teen would experience it
- Any fee, application, interview, background check, orientation, or minimum commitment
- **Whether a liability/parental waiver is required for volunteers under 18, and
  exactly where and how it's obtained.** Always check this — don't wait for a row or
  the user to flag it first. "The page mentions a release form" is not enough: pin down
  whether it's an online form with a direct link, a printed form mailed or emailed in
  advance, something signed in person at check-in, or folded into a larger
  application/orientation packet — and whether it needs a parent/guardian signature for
  minors specifically, not just adult accompaniment. This has repeatedly turned out to
  be a separate step from the main signup application, sometimes deliberately not
  linked from the public volunteer page at all (an org can require the waiver only once
  a coordinator has directed a specific volunteer to it — see the Waivers judgment call
  below). Confirm against the org's own current volunteer page or a document you can
  actually open — an embedded application form you can scroll through counts; a
  login-gated portal that requires creating an account to reach the waiver screen does
  not, since creating accounts is off-limits. Treat that case as unconfirmed and say so,
  rather than guessing what the gated screen probably says.
- Days and times, and whether the program is seasonal or currently paused
- Street address, or an explicit note that the org operates at rotating locations
- Contact email and phone

When a page contradicts itself, or an FAQ and a signup form disagree, record both and
flag it. Do not silently pick the more convenient reading.

**Reach every URL by navigating from the organization's own root domain.** Don't trust a
link because a search result, a directory, or (if you're checking a user submission) the
submission itself handed it to you. Start at the org's homepage, find the volunteer page
from there, and use what you land on. Impersonating a real, well-known organization is a
far easier attack than inventing a fake one, and a plausible link is the whole of it. If
you can't reach the signup page from the org's own homepage, that is a REJECT, not an
UNVERIFIED.

**Automated fetches sometimes return 404 on JavaScript-heavy portals that work fine in a
real browser.** Treat a single 404 as "needs a human to open it in a browser," not as
proof the link is dead — that exact ambiguity is already an open flag on the Sophia Way
listing.

### Step 5 — Judge against the criteria

Sort every candidate into one of four buckets:

- **PASS** — meets all six criteria with evidence for each.
- **PASS WITH FLAG** — listable, but with a caveat a teen needs to know up front
  (background check, minimum commitment, narrow age window). Hopelink is listed this
  way. The flag must be stated in the listing itself, not just in the report.
- **UNVERIFIED** — a narrow, residual bucket. See the rule below: it is ONLY for a fact
  that is published on the org's own pages but that *this session* couldn't render.
- **REJECT** — fails a criterion, the Step 3b organization gate, a categorical
  exclusion, or the findability rule below. Name which one and cite the evidence. A
  gate failure is a harder no than a criteria failure: a criteria reject may become
  listable if the org changes its process, but a gate reject stays out until the org's
  *registration* changes.

Verdicts of "probably fine" or "likely 14+" don't belong in any bucket.

#### The findability rule — a missing SIGNUP PATH is a REJECT, not an email

**Set by Krish on 2026-10-06 and narrowed by him the same day. This replaces the previous
"UNVERIFIED is a primary deliverable" guidance, which told runs to collect unverified
entries and attach a draft email to each. Do not do that any more — no drafted emails, ever.**

The thing Krish actually wants is: **Elpys never hands him or a teen homework.** If a fact
is missing from an org's own public pages and you'd have to email them to get it, do not
write that email and do not park the entry hoping a reply rescues it. What you do next
depends on *which* fact is missing, and this is the distinction that matters:

**REJECT — the missing fact blocks a teen from working out how to sign up.** There is no
usable path from the org's own pages to a claimed spot. A teen hits a wall. Real examples:

- **Bellevue LifeSpring Youth Council** — the contact email is scrambled by an anti-spam
  script and cannot be read from the page at all. There is no way to apply.
- **Bellevue Youth Council** — meets first and third Wednesday, applications open
  year-round, parent-signed form published… and **no venue or address anywhere.** A teen
  cannot find out where to show up.
- **Keep Bellevue Beautiful, Nov 2026** — dates announced, but "exact locations will be
  announced soon", no registration link, no event page. Nowhere to go and nothing to click.

**KEEP — the missing fact is one Elpys wanted for a field, and signup is frictionless.**
The teen clicks through from the org's own page, picks a slot, and is done. Nothing is
blocked. State the gap plainly on the card instead of guessing a value, and list it.

- **The 2026 Bellevue Tree Giveaway is the reference case.** City of Bellevue, Tier A,
  SignUpGenius registration one click off the `.gov` page, both shifts open, no
  application, no screening — and **no minimum age published anywhere, including on the
  signup page itself.** It was rejected on 2026-10-06 under the un-narrowed rule, Krish
  reconsidered, and it was reinstated with `age_display` = "No minimum age published".
  **Do not reject this shape of listing.**
- Precedent that already existed on the live site: row **104 Renewal Food Bank** publishes
  no minimum age anywhere (the weekly check re-confirms this every week) and row **102
  Jubilee REACH** runs with `age_display` "Contact to confirm". Both are published.
- An unpublished age floor on a come-help-out public event usually means there isn't one.
  Contrast the **Bellevue Family YMCA**, whose catalogue publishes 18+ and 21+ on other
  roles, so a blank age field there genuinely means "not set" — that ambiguity is real and
  those three roles were correctly rejected.

**The test, in order:**

1. Can a teen get from the org's own homepage to a claimed spot? If no → **REJECT**.
2. If yes, is some fact Elpys wants still unpublished? → **KEEP**, say so on the card, and
   never assert a number you have not sourced.

**Never guess the missing value, and never tell the teen to go ask.** `age_display` of
"No minimum age published" is honest and useful. A guessed "14+" is the exact failure Elpys
exists to prevent. And `signup_steps` must not contain "email them to check" — that is the
homework rule again, pointed at the teen instead of at Krish.

**A page this session can't render is not a missing fact at all.** A page that is unreadable
*to this task* but one click away *for a teen* has nothing missing from it. This is the only
thing UNVERIFIED is still for, and even then the listing is kept, not held back:

- A SignUpGenius or Eventbrite registration page linked straight off the org's own `.gov`
  page. `robots.txt`-blocked to WebFetch, fine in a teen's browser.
- A Salesforce or Volgistics portal linked from the org's own page. Same shape.
- A JavaScript-only page that renders normally in a real browser.

Keep the listing, state the unconfirmed fact on the card, stamp `needs_browser_check`, and
say in `admin_notes` exactly which URL needs a human's browser and what to read off it.

**Handing off the blocked pages.** A scheduled cloud run has no browser at all: no device
bridge, no Claude in Chrome, and the sandbox's egress proxy denies the CONNECT for *every*
external host, so Playwright and `curl` fail even against sites WebFetch can read (verified
2026-10-06 with a headless Chromium against a control URL). Don't burn time rediscovering
this. Instead, end the run by writing a Cowork prompt that lists each blocked URL and the
one thing to read off it, for a session attached to Krish's computer to run in a real
browser.

#### When no age minimum is published

Common enough to need a settled rule rather than a per-case judgment call. Both of these
came up in the same run and were initially sorted inconsistently:

- Unstated age **plus** explicit "all ages" or "all community members welcome" language,
  and no sign an adult is required → **PASS WITH FLAG**. The flag goes in `card_note` as
  a note to confirm before a first shift. The org has signalled openness; the gap is
  documentation, not policy.
- Unstated age, **but signup is frictionless** — one click from the org's own page to a
  claimed slot, no application and no screening → **PASS WITH FLAG**, with `age_display`
  stating the gap ("No minimum age published"). The 2026 tree giveaway is the reference
  case. Do not reject this.
- Unstated age **plus** an application, a screening step, or "apply to be considered"
  language → **UNVERIFIED, leaning reject.** Selective intake plus an unknown floor is two
  unknowns compounding, and a teen can't tell whether applying is worth their time. If
  there is also no usable path to apply, it is a REJECT on the signup path instead.
- Unstated age **plus** 18+ or 21+ roles published elsewhere on the same site → **REJECT**.
  A blank age field on a site that states floors elsewhere means "not set", not "any age".
  (This is what sank the Bellevue Family YMCA's three Bellevue youth-sports roles in the
  October 2026 run, and the contrast with the tree giveaway is the point: the city states
  no age anywhere, the YMCA states ages everywhere except here.)
- Unstated age, but the age IS published on a registration page linked from the org's own
  site that this session couldn't render → **PASS WITH FLAG**. `age_display` states the
  gap and `needs_browser_check` gets stamped.

### Step 6 — Write the output

Produce both deliverables, in this order: the report first, then the paste-ready rows
for the PASS and PASS-WITH-FLAG entries only. `references/output-format.md` has the
exact templates and the database field conventions, which are fiddly and easy to get
wrong (pipe-separated steps, lowercase comma-separated categories, `status` always
`pending`). **That reference file predates the `opportunity_type`/`event_date` columns
(added Aug 2026)** — until it's updated to match, include those two fields in every row
yourself: `opportunity_type: 'recurring'` (the default — leave `event_date` empty) for
an ongoing-schedule listing, or `opportunity_type: 'one_time'` with `event_date` set to
the sourced date for a one-off. Don't omit them because the reference template doesn't
show them yet.

When a waiver requirement was confirmed in Step 4, name it explicitly in
`signup_steps` as its own step (or appended to the step it belongs to) — not just in
the report or `admin_notes` — in the same style as every other step: pipe-separated,
direct second-person instructions, no headers or bullet symbols. Say where it's
obtained and whether a parent/guardian signature is needed for under-18 volunteers
specifically, and place it at the point in the process where it actually happens (see
the Waivers judgment call below for the case where that's later than the initial
application).

Every paste-ready row must also carry the Step 3b fields — `org_tier`,
`org_legal_name`, `ein`, `wa_charity_number`, `org_domain` — plus a `verification`
object recording what was checked, when, and the source URL for each answer. The admin
panel will not publish a listing without them, so a row missing them is not actually
ready to paste. Leave `verified_at` unset: it is stamped by the human who approves the
listing, not by this skill, because the whole point is that a person confirmed it.

Never write to the database directly. New listings go in as `pending` for the user to
review through the admin page, because the whole value proposition is that a human
verified them.

---

## Standards of proof

These are the difference between a scouting run that saves the user time and one that
creates a cleanup task.

**Cite a URL for every factual claim about an org.** Age minimums, fees, waiver
requirements, and signup steps all need a source the user can re-check in under a
minute.

**Prefer "unknown" to a plausible guess.** An unverified age minimum that turns out to
be wrong sends a 13-year-old to a site that will turn them away — the precise failure
mode Elpys was built to prevent. The same discipline applies to waivers: don't record
"no waiver required" just because a page doesn't mention one if the actual signup
happens behind a portal you couldn't fully inspect — say exactly what you checked and
where the remaining gap is instead of letting silence read as a confirmed no.

**Never invent coordinates, but do geocode — there is a geocoder that works.** `lat`/`lng`
must come from a real geocode of the real address. **Use the US Census Bureau geocoder**,
which is reachable from the cloud sandbox and is not robots-blocked:

```
https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<urlencoded>&benchmark=Public_AR_Current&format=json
```

It returns `x` as **longitude** and `y` as **latitude** — don't swap them. A structured
variant (`/locations/address?street=&city=&state=&zip=`) and a `Public_AR_Census2020`
benchmark are worth trying if the one-line form returns an empty `addressMatches`. Nominatim
is robots-blocked; don't bother with it.

If an address genuinely won't resolve after a couple of spellings, leave the fields empty,
mark them `TODO — geocode`, and say which spellings you tried; a wrong pin is worse than a
missing one. Don't substitute a nearby address's coordinates. For a listing with rotating
locations, use the anchor city's civic-centre coordinates with `approx = true`, which is the
convention existing row 96 (King County Parks) already follows, and say in the report that
the pin is the anchor rather than a venue.

**Don't smooth over friction.** If signup requires an application and an interview, the
report says so plainly even if that kills an otherwise attractive listing. The user has
been explicit about preferring honest assessment over encouragement.

**A one-time event's `event_date` gets the same proof standard as any other fact, and
then a freshness check on top.** Cite the source page for the date the same way as an
age minimum or a fee. Then, separately, confirm it's still in the future as of when the
report is handed over — a well-sourced but already-past date is still a reject (see
"Episodic vs. ongoing" below), not an UNVERIFIED.

**Never state or imply that an organization is safe.** The gate establishes that an org
is real and accountable, which is a different and much narrower claim. Reports and
`card_note` text should say what was checked, never "verified safe", "vetted", or
"screened" — Elpys's terms disclaim exactly that, and language that contradicts them is
worse than no language at all.

**Distinguish a directory from an opportunity.** United Way and JustServe were excluded
deliberately: they're places to *mine* for candidates, not things to list. If a
candidate just aggregates other orgs' shifts, mine it and list what it points to.

---

## Judgment calls worth making deliberately

*Age floors.* Elpys sets no hard floor, but the audience is middle and high school. An
org that only takes 18+ is a reject; one that takes 16+ is a narrow but real listing.
Say which teens it actually serves.

*Waivers.* Always check for a liability/parental waiver requirement as part of Step 4 —
don't wait for a row or the user to specifically call it out; treat it as a standard
fact to extract for every candidate, the same as age or address. A parent-signed
waiver completed at home is fine. A parent who must be physically present is not.
Watch for the middle case — a waiver that must be printed and brought to the site, as
with WTA and King County Parks — which is listable but belongs in the signup steps,
since a teen who shows up without it gets turned away. Also watch for the *split*
case: some orgs run the waiver as a step separate from the main application —
sometimes a form that's only given to a volunteer once a coordinator has directed them
to it, and deliberately not linked from the public volunteer page (Bellevue Botanical
Garden's "BBG Volunteer Waiver" is the reference example — it's explicitly "not a
volunteer application," is 18-and-older with a parent/guardian completing it for anyone
younger, and only surfaces after a coordinator directs a specific volunteer to it).
That's still a real, confirmable requirement — verify it the same way as anything else
(the org's own page or a document you can open, not a guess) and place it in
`signup_steps` at the point in the process where it actually happens, not bundled into
the initial application step just because that's where waivers usually go. A shared
parent organization (a city Parks department, say) can also apply the same waiver
policy across multiple otherwise-unrelated listings — check whether a general
handbook/policy document governs several candidates at once before treating each one as
a separate unknown.

*Seasonality.* A program that runs only in summer is still worth listing if it's clearly
labeled, but check whether the current application window is open. Sold-out or closed
windows are a reject until they reopen.

*Episodic vs. ongoing.* One-off events (park cleanups, market days) are often the best
listings for teens precisely because they require no commitment. Don't undervalue them
against a more "serious" ongoing role.

A candidate that repeats on a real schedule — "every Saturday," "weekday afternoons,
May–October" — is `opportunity_type: recurring`, same as every existing listing. A
candidate that happens once, on one calendar date — a specific school event, a single
park cleanup, a one-day festival — is `opportunity_type: one_time`, with `event_date`
set to that exact date (`YYYY-MM-DD`), sourced from the org's own page like any other
fact. A program that's seasonal but still repeats within the season (the farmers market
running every Saturday May–October) is still `recurring`; the test is whether there's a
schedule to repeat, not whether the season is short.

A `one_time` candidate whose `event_date` has already passed, or will plausibly pass
before the user reviews the submission queue, is a **REJECT** regardless of how well it
otherwise meets the criteria — list it and the row is dead on approval. If the date is
close (say, within a few days), say so prominently in the report so the user knows to
review it fast rather than finding it stale later.

---

## Reference files

All three are present and current as of Oct 2026. **Read `criteria.md` in full before
sorting any candidate** — it is short, and its reject list and accuracy corrections are
the part that saves real mistakes.

- `references/criteria.md` — the organization gate (section 0), the six criteria, the
  disqualifiers observed in practice, **the explicit reject list**, the orgs removed for
  distance, the accuracy corrections not to regress, and a per-candidate verification
  checklist. The gate here and Step 3b above say the same thing.
- `references/sourcing.md` — where candidates actually come from, ranked by yield, with
  the search patterns that work. Two worth remembering: search the *age* rather than the
  activity, and follow a shared volunteer portal to find orgs with no discoverable
  volunteer page of their own.
- `references/output-format.md` — the report template, the full database field
  conventions table, a worked example row, and the SQL form. **Use dollar-quoting
  (`$$…$$`) in generated SQL, not escaped apostrophes** — escaped quotes have been
  mangled by copy-paste before and produced hard-to-diagnose syntax errors.

**A note on why this section used to say these files were missing.** For four
consecutive runs, sessions reported that only `SKILL.md` was in the skill cache and
logged the references as unavailable or needing updates they had never received. The
files existed the whole time; they simply were not packaged with the installed skill.
That gap caused a real error in Oct 2026 — the run proposed KidsQuest Children's Museum
and Bellevue Youth Theatre as listable when both were already on the reject list below.
**If a future run finds `references/` empty again, say so plainly and treat the reject
list as unknown rather than empty**, and do not record in any report that the list was
consulted when it was not.
