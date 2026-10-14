# How specific organizations' sites behave in an automated browser

Read the entry for the organization you're checking before you start — it
saves going in circles. Add to this file when a site surprises you.

## City of Bellevue programs (Kelsey Creek Farm, Botanical Garden, Highland Community Center…)

- The program page on bellevuewa.gov is only the summary. Fees, exact days,
  times and open spots live in the city's registration catalog
  (`wa-bellevue.civicrec.com`), reached from each program's "Volunteer
  Registration" or "Register Online" link.
- In the catalog, click the activity name to expand its sessions, then click
  a session name to see "Fee", "Date Range", "Schedule Details" and
  "Enrollment" (e.g. "3/4 WL" = 3 of 4 spots taken).
- After navigating there, wait a few seconds before reading the page — an
  early read returns the previous page's text.
- Oct 2026: Kelsey Creek Farm's teen volunteer programs cost $15 resident /
  $18 non-resident per session. Check fees on every city program; this is
  where they hide.

## Washington Trails Association (wta.org)

- The work party search filters and the List/Map/Calendar tabs don't respond
  to automated clicks. Page through results by navigating to
  `https://www.wta.org/volunteer/schedule/?batch_num=N&batch_size=10`
  (N = 1…14 or so), and read each page with `document.body.innerText`;
  look for "Region Issaquah Alps" to find Eastside work parties.
- Rules for youth are on the trail work party FAQ:
  `https://www.wta.org/volunteer/volunteering/questions` ("Can I bring my
  kids…", "How do I sign the liability waiver?", start and end times).
- WTA's pages say youth must be 10+; Elpys's "14+ on your own" cutoff is
  Elpys's own wording, not WTA's.

## The Sophia Way

- Facts for the donation center are inside the "Donation Center Assistant"
  tab on sophiaway.org/volunteer; click the tab, then read the panel.
- The Bloomerang sign-up page (volunteer.bloomerang.co) returns no text to a
  normal page read; use `document.body.innerText` via JavaScript. Its first
  sign-up screen asks for an email address — stop there. Never type a real
  email or submit anything.

## General

- Never enter personal details or submit any form on an organization's site
  to "see what happens next". Report how far you could check.
- If a site's controls don't respond after two or three tries, stop trying
  that route, find another (direct URLs, page text via JavaScript), and if
  nothing works, report the fact as unconfirmed.
