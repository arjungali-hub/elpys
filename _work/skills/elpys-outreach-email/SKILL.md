---
name: elpys-outreach-email
description: Prepare an Elpys outreach email to an organization that is already listed on Elpys — first re-verify that organization's Elpys listing against its own live website in a real browser (ages, adult rule, fees, days and times, sign-up steps, contact details), then fill in Krish's approved email template for it. Use whenever Krish asks for the outreach email template, asks to fill it in for an organization, asks "is X accurate before I email them", "write the email for Kelsey Creek Farm", "who's next on the outreach list", or anything about emailing a listed organization, even if he doesn't say "verify". Also use for a bare "give me the template".
---

# Elpys outreach email: verify, then fill in

Elpys emails the organizations it already lists, telling them they're on the
site. Krish's template tells them, in his own name, that the details came
from their own website and that every listing is checked before it goes on
the site. If the listing is wrong on the day the email goes out, the
organization opens its page, sees the mistake, and the very first contact
Elpys ever makes with them is an embarrassment. So this skill is two jobs,
in this order:

1. **Verify** the listing against the organization's own live pages, today.
2. **Fill in** the template — and only call it ready to send if step 1 passed.

The verification is the important half. Filling in three blanks is easy.

Krish is not technical. Report in plain words, short. Never use jargon like
"jsonb", "row", "slug" or "SPA" in what you tell him without a plain
explanation; prefer "the days/times the homepage filters use", "the listing",
"the page address".

## When it's just the generic template

If Krish only asks for the template (no organization named), give him the
text from `references/template.md` exactly, with the brackets left in, and a
`Send to: [the organization's volunteer email]` line above it. No
verification needed. Stop there.

## Step 1 — Load the listing

Read the organization's listing from Supabase (project `ukrykzmehvghedrvmkjj`)
with `execute_sql`. Read-only: **never insert, update or delete** — Krish runs
any database changes himself. The table name needs double quotes and a capital
O, and so do the `"when"` and `"where"` columns:

```sql
select id, name, slug, status, description, long_description, category,
       age_display, age_min, age_condition, age_filter, "when", "where",
       address, signup_link, signup_label, signup_steps, section, card_note,
       website, live_url, contact_email, contact_phone, schedule,
       opportunity_type, event_date, org_tier, org_domain, admin_notes
from "Opportunities"
where name ilike '%<org>%';
```

- More than one match, or none: ask Krish which one he means.
- `status` isn't `published`: say so — Elpys shouldn't tell an organization
  "you're listed" about a page that isn't live.
- No `contact_email`: say so; the email needs somewhere to go.

## Step 2 — Check every claim against the organization's own pages, in a real browser

Use a real browser, in this order of preference: Playwright, then Claude in
Chrome, then Claude's built-in browser. (From a cloud session Playwright
usually can't reach outside sites — if it's refused, move straight to Claude
in Chrome. Read that browser's own skill first.) A plain web fetch is **not**
enough: the facts that most often go wrong live on sign-up portals that only
load in a browser. That's exactly why the automatic weekly check missed Kelsey
Creek Farm's fee — it said "no change needed" one week before a browser found
a $15 charge.

Before you start, read `references/site-notes.md` — it says how specific
organizations' sites behave in an automated browser (where fees hide, which
search pages need direct links instead of clicks). Add to it when a site
surprises you, so the next run doesn't go in circles.

Start from the page in the listing's `website` field (or the organization's
own homepage) and **follow the sign-up links all the way through** — into
registration catalogs, VolunteerHub, Galaxy Digital, Bloomerang, SignUpGenius,
Volgistics and the like. Open the actual session or shift details, not just
the summary card. Never trust a link that came in a submission; navigate from
the organization's own site.

Check each of these against what the pages say today:

| What the listing says | What to look for on their pages |
|---|---|
| Age (`age_display`, `age_min`, `age_condition`) | The stated age range for each program, and any "under X needs an adult present" rule. If our listing has an adult rule their pages no longer state, it is **unconfirmed**, not correct. |
| Free | Any fee, per session or one-time, resident vs non-resident. Elpys's rule is: free, or the fee is clearly flagged. A fee hidden behind a "Register" button still counts. |
| When (`"when"`) and the homepage filter days/times (`schedule`) | The actual days and hours. Check the `schedule` field separately — it drives the homepage Day and Time filters, and if it marks every day and time when the program only runs Wednesdays, a teen filtering for Monday is misled. |
| Where / address | The address on their contact block or session details. |
| Sign-up steps and button | That the steps still match how sign-up actually works, in that order, and that every link in them opens. |
| Card note and long description | Re-read the prose against the facts. Corrections often land in the structured fields and miss the paragraph (e.g. the paragraph still calls something free after the fee field was fixed). |
| Contact email and phone | Match their published contact details. |
| One-time event (`event_date`) | The event is still on, on that date. |

Also open the Elpys listing itself at `elpys.vercel.app/<slug>`, confirm it
loads, and check the console for errors.

When an automated summary of a page is the basis for a correction, re-read
the page itself word for word before believing it — summaries paraphrase, and
one nearly invented a guardian rule for WTA.

Close every tab you opened as soon as you're done.

## Step 3 — Report

Krish wants this short. He reads the verdict, sees what to do, and acts. Use
exactly this shape, in this order, and keep each part as brief as it can be
while still being precise:

1. **Verdict** — one line: **Ready to send** or **Don't send yet**.
2. **What I found** — at most 3 short bullets, one fact each, problems only.
   Say what the listing says and what their page says, in a few words. Then
   one line: "Everything else matches: …" listing the other things checked,
   comma-separated. No narration of how you browsed.
3. **Your call** — only if something is genuinely uncertain or is a choice
   rather than a fact (e.g. a fee appeared: flag it on the listing, or take
   the listing down?). For each one, give:
   - the choice in one line,
   - **Do it if:** the precise reasons for,
   - **Don't if:** the precise reasons against,
   - your recommendation in one line.
   Skip this section entirely when there's nothing uncertain.
4. **Next steps** — a numbered list of exactly what Krish does, in order,
   each step one line and as little work for him as possible (e.g. "1. Run
   the SQL below in Supabase. 2. Tell me when it's done and I'll re-check
   the page. 3. Send the email."). If you can do a step yourself, don't put
   it on his list. For "Ready to send" this is usually just "Send it from
   hello.elpys@gmail.com."

Then the draft (step 4).

Offer the exact SQL for any listing fix he has to make. When you write SQL:
double-quote
`"Opportunities"`, `"when"` and `"where"`, use dollar-quoting (`$$...$$`) for
text instead of escaped apostrophes, and avoid semicolons inside text values
(they hang the Supabase connector).

## Step 4 — Fill in the template

Use `references/template.md` word for word; only the brackets change. The
file explains each blank.

**Put the address to send it to at the very top**, on its own line, before
the subject: `Send to: <contact_email from the listing>`. Krish asked for
this so he never has to look the address up. If their own pages now publish
a different volunteer address than the listing has, say so and use theirs.

Deliver it so it's easy to copy — the email-drafting card (message compose
widget) works well, one variant, labelled with the organization's name. The
card has no "to" field, so write the `Send to:` line in your message directly
above the card (not inside the body, where it would get pasted into the
email).

If the verdict was "Don't send yet," still give the filled-in draft if he
asked for it, but say clearly above it that it's for after the listing is
fixed.

### Writing the specific sentence

This is the sentence the organization reads as proof Elpys actually looked.
It has to be:

- **Specific to this program** — something only true of them, not "you do
  great work".
- **Verified today** in step 2. Never build it on a fact that came back
  unconfirmed. (First draft for Kelsey Creek Farm praised it as a way for
  12-year-olds to volunteer on their own — but the 12–13 rule was exactly the
  unconfirmed fact. It had to be swapped.)
- **Free of anything they could dispute** — no "the only", no claims about
  other organizations, no prices, nothing about their staff.
- **One sentence, warm, in a teen's natural voice.**

Good shape: name a real task or feature of the program from their own page.
"Your Saturday morning program, where teens help bring the animals out to
pasture, is a great fit for students who want real hands-on animal care."

## Step 5 — Log it

Follow the Elpys project rules for the "Elpys Project Context" Claude Doc:
add a dated Change log entry the same session saying which organization was
checked, how (which browser), what matched, what didn't, and whether the
email was cleared to send. Write the text to a local file first and read the
doc back to confirm it landed exactly. Change nothing in the database.

## Things that are settled — don't re-raise them

- Krish sends the emails himself from hello.elpys@gmail.com. Never send
  anything on his behalf.
- He signs as Arjun; that's his name for Elpys work.
- One follow-up at most, about two weeks after no reply.
- Decisions recorded in the project doc (for example, keeping the Bellevue
  Tree Giveaway listing) stand unless Krish changes them.
