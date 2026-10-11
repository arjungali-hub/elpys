# Output format

Two deliverables, in this order: the **report** (so the user can audit the reasoning),
then the **paste-ready rows** (so passing candidates can be added without retyping).

For a run producing more than about three passing candidates, write the report to a
markdown file and present it, rather than dumping everything inline — it's a document the
user will come back to while emailing orgs.

---

## Part 1 — Report template

```markdown
# Elpys scouting run — <Anchor location>
**Run date:** <date> · **Anchor point used:** <specific point> · **Radius:** ~20 min drive

## Search frame
- **Inner ring (~10 min):** …
- **Outer ring (~10–20 min):** …
- **Excluded as too far:** … (with the reason each is out)

## Summary
<N> candidates researched · <N> pass · <N> pass with flag · <N> unverified · <N> reject

## Passing — ready to list
### <Org name> — <one-line what they do>
- **Verdict:** PASS
- **Ages:** <solo age> / <accompanied age if different>
- **Adult required on-site:** No — <evidence>
- **Cost:** Free
- **Signup:** <online | contact> — <the actual path in one sentence>
- **Where:** <address, or "rotating locations">
- **When:** <days/times/season>
- **Contact:** <email> / <phone>
- **Sources:** <URL>, <URL>

## Passing with a flag
Same shape, plus:
- **Flag:** <the caveat, stated the way a teen needs to hear it>

## Unverified — one question each, ready to email
*Ordered by how cheaply the question can be answered — work down the list.*
### 1. <Org name>
- **Looks promising because:** …
- **Blocking question:** <the single specific thing that's unclear>
- **What the answer decides:** <"if yes → PASS; if no → fails criterion 1">
- **Who to ask:** <email/phone>
- **Sources checked:** <URL>

## Rejected
| Org | Failed criterion | Evidence |
|---|---|---|
| … | Adult required on-site | <URL> |

## Notes and judgment calls
<Anything borderline, contradictory sources, seasonal windows closing soon, or
observations worth carrying into the next run.>
```

Keep the rejected table — it's what stops the next run from re-researching the same
dead ends, and it's the raw material for the user's org-emailing list.

---

## Part 2 — Database rows

Only PASS and PASS-WITH-FLAG entries. Present each as a labeled block the user can paste
into the admin flow, plus an optional SQL insert.

### Field conventions

These are easy to get wrong and cause real bugs — a past submission stored a JSON array
where the schema expects pipe-separated text, and a capitalized category where every real
row is lowercase.

| Field | Convention |
|---|---|
| `name` | Org name, plus program if the org has several: `Kelsey Creek Farm — Saturday Teens` |
| `description` | 1–2 sentences for the card. Concrete tasks, not mission statements. |
| `long_description` | A paragraph for the detail page: what the work is like, what to expect, who it fits. |
| `category` | **lowercase, comma-separated.** Existing values: `environment`, `food`, `community`, `animals` |
| `age_display` | Human-readable, e.g. `14+ solo (12–13 w/ adult)` |
| `age_min` | Integer only, the lowest age that can attend at all. Blank if all ages. |
| `age_condition` | Range where extra conditions apply, e.g. `12-13` |
| `age_filter` | Matches the card's filter attribute, e.g. `14+`, `8-12`, `all`, `varies` |
| `when` | e.g. `Saturdays, 9 am–12 pm` or `Rotating weekday events` |
| `where` | Short human label, e.g. `Bellevue` or `Eastside parks` |
| `address` | Full street address. Blank only if genuinely rotating. |
| `lat` / `lng` | From a real geocode of that address. Never estimated — leave blank and mark `TODO — geocode` if unavailable. |
| `signup_link` | The **actual signup URL**, never a homepage. This is the whole point of the site. |
| `signup_steps` | **Pipe-separated text**: `step one \| step two \| step three`. Not JSON, not newlines. |
| `signup_label` | Defaults to `Sign up →`. Use `Email to sign up →` or `Apply →` when more accurate. |
| `section` | `online` or `contact` |
| `status` | **Always `pending`.** Never insert as published. |
| `slug` | lowercase, hyphenated, no org suffix noise: `renewal-food-bank` |
| `approx` | `true` when the pin is representative rather than exact (rotating locations) |
| `live_url` | The org's live events/locations page, when the pin is approximate or one of several |
| `card_note` | Caveats: fees, commitments, printed waivers |
| `website`, `contact_email`, `contact_phone` | As published by the org |
| `opportunity_type` | `recurring` (default — an ongoing schedule) or `one_time` (happens once). Added Aug 2026. |
| `event_date` | `YYYY-MM-DD`, **only** for `one_time` rows, sourced from the org's own page. Leave blank for `recurring`. |
| `org_tier` | `government` or `charity`, from the section 0 gate in `criteria.md`. Added Aug 2026. |
| `org_legal_name` | The registered legal name, which is often not the trading name |
| `ein` | IRS Employer Identification Number. Tier B (charity) rows only. |
| `wa_charity_number` | WA Secretary of State charity/UBI registration number. Tier B only. |
| `org_domain` | The canonical **registrable** domain only — `earthcorps.org`, not `https://earthcorps.org/volunteer` and not `portal.earthcorps.org`. The weekly data check compares signup links against this, because an expired domain someone else re-registers is the quiet failure mode. |
| `verification` | JSON object: `{"checks":[{"check":"…","result":"…","source":"…"}]}` — one entry per gate check, each with the URL that confirmed it. This is where verification evidence goes now. |
| `verified_at` | **Leave blank.** Stamped by the human who approves the listing in the admin panel. A scouting run never sets it. |
| `admin_notes` | Working notes for the reviewer — anything unresolved, contradictions found, questions to settle before publishing. Verification evidence belongs in `verification` instead. |

Put the flag from a PASS-WITH-FLAG verdict into `card_note`, not only into
`admin_notes` — the teen needs to see it before they show up, not the reviewer.

### Worked example

```
name:              Renewal Food Bank
slug:              renewal-food-bank
description:       Sort and shelve donated groceries and help pack food orders at a
                   Bel-Red food bank serving Eastside families.
long_description:  Shifts run in the warehouse and sorting area, checking dates on
                   donated food, restocking shelves, and building grocery orders for
                   families. It's steady, physical, indoor work with staff on hand, and
                   a good fit if you'd rather be busy than talk to strangers all shift.
category:          food, community
age_display:       14+
age_min:           14
age_condition:     (blank)
age_filter:        14+
when:              Weekday shifts, see signup calendar
where:             Bellevue
address:           15022 NE Bel-Red Rd, Bellevue, WA 98007
lat / lng:         TODO — geocode
signup_link:       https://renewalfoodbank.org/volunteer
signup_steps:      Open the volunteer page and pick a shift on the calendar | Fill in
                   your name, email, and phone | Show up at the Bel-Red entrance a few
                   minutes early
signup_label:      Sign up →
section:           online
status:            pending
approx:            false
live_url:          (blank)
card_note:         (blank)
website:           https://renewalfoodbank.org
contact_email:     development@renewalfoodbank.org
contact_phone:     425-736-8132
opportunity_type:  recurring
event_date:        (blank)
org_tier:          charity
org_legal_name:    Renewal Food Bank
ein:               <from IRS TEOS>
wa_charity_number: <from ccfs.sos.wa.gov>
org_domain:        renewalfoodbank.org
verified_at:       (blank — the admin panel stamps this on approval)
verification:      {"checks": [
                     {"check": "irs_exempt",        "result": "current 501(c)(3)", "source": "<URL>"},
                     {"check": "irs_not_revoked",   "result": "not on the list",   "source": "<URL>"},
                     {"check": "wa_charity_active", "result": "active",            "source": "<URL>"},
                     {"check": "form_990_on_file",  "result": "FY2024 filed",      "source": "<URL>"},
                     {"check": "exclusions",        "result": "all clear",         "source": "<URL>"}
                   ]}
admin_notes:       Age minimum not stated on the live page — 14+ carried over from prior
                   listing and still unconfirmed; ask before publishing.
```

The admin panel will refuse to publish a listing without `org_tier`, `org_domain` and a
`verification` object (plus `ein` and `wa_charity_number` for a charity), so a row
missing them is not actually ready to paste.

### SQL form

When the user wants to insert directly, use dollar-quoting rather than escaped
apostrophes — escaped quotes have been mangled by copy-paste before and produced
hard-to-diagnose syntax errors. Keep `"Opportunities"` and `"where"` double-quoted;
`where` is a reserved keyword.

```sql
INSERT INTO "Opportunities"
  (name, slug, description, long_description, category, age_display, age_min,
   "when", "where", address, signup_link, signup_steps, section, status,
   website, contact_email, contact_phone, admin_notes)
VALUES
  ($$Renewal Food Bank$$, $$renewal-food-bank$$, $$…$$, $$…$$, $$food, community$$,
   $$14+$$, 14, $$Weekday shifts$$, $$Bellevue$$, $$15022 NE Bel-Red Rd, Bellevue, WA 98007$$,
   $$https://renewalfoodbank.org/volunteer$$,
   $$Open the volunteer page and pick a shift | Fill in your details | Show up early$$,
   $$online$$, $$pending$$, $$https://renewalfoodbank.org$$,
   $$development@renewalfoodbank.org$$, $$425-736-8132$$,
   $$Verified <date> against live page.$$);
```

Present the SQL; don't run it. New listings go through the admin review flow so a human
signs off before anything is published.
