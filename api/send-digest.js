// Weekly digest — sends matching new opportunities to each subscribed user.
// Triggered by Vercel cron (Authorization: Bearer $CRON_SECRET)
// or manually from the admin panel (x-admin-password header).

const crypto = require('crypto');
const sendEmail = require('../lib/sendEmail');
const { checkAdminPassword } = require('../lib/adminAuth');

// Matches api/submit.js and api/review.js: tolerates SUPABASE_URL given with or
// without the /rest/v1/ suffix, which would otherwise 404 every query silently.
function restBase(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u.endsWith('/')) u += '/';
  if (!/\/rest\/v1\/$/.test(u)) u += 'rest/v1/';
  return u;
}

const SUPABASE_REST = restBase(process.env.SUPABASE_URL); // https://xxx.supabase.co/rest/v1/
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET   = process.env.CRON_SECRET;

function supaHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
}

function _parseSchedule(when) {
  const w = (when || '').toLowerCase();
  const days = [], times = [];
  if (/monday|tuesday|wednesday|thursday|friday|\bweekday|\bmon\b|\btue\b|\bwed\b|\bthu\b|\bfri\b/.test(w)) days.push('weekdays');
  if (/saturday|sunday|\bweekend|\bsat\b|\bsun\b/.test(w)) days.push('weekends');
  if (!days.length) { days.push('weekdays'); days.push('weekends'); }
  if (/\bmorning\b|\b(8|9|10|11)\s*am\b/.test(w)) times.push('morning');
  if (/\bafternoon\b|\bnoon\b|\b(12|1|2|3|4)\s*pm\b/.test(w)) times.push('afternoon');
  if (/\bevening\b|\b(5|6|7|8|9|10|11)\s*pm\b/.test(w)) times.push('evening');
  const ranges = w.match(/\b(\d{1,2})\s*[–\-]\s*\d{1,2}\s*pm\b/g) || [];
  ranges.forEach(r => {
    const s = parseInt(r);
    if (s >= 8 && s <= 11 && !times.includes('morning'))   times.push('morning');
    else if ((s === 12 || (s >= 1 && s <= 4)) && !times.includes('afternoon')) times.push('afternoon');
    else if (s >= 5 && s <= 9 && !times.includes('evening')) times.push('evening');
  });
  if (!times.length) { times.push('morning'); times.push('afternoon'); times.push('evening'); }
  return { days, times };
}

const WEEKDAY_KEYS = ['monday','tuesday','wednesday','thursday','friday'];
const WEEKEND_KEYS = ['saturday','sunday'];

function availabilityMatches(schedule, availability) {
  if (!availability || typeof availability !== 'object') return true;
  const hasSlots = Object.values(availability).some(slots => Array.isArray(slots) && slots.length > 0);
  if (!hasSlots) return true;
  return schedule.days.some(oppDay => {
    const keys = oppDay === 'weekdays' ? WEEKDAY_KEYS : WEEKEND_KEYS;
    return keys.some(d => {
      const userSlots = availability[d] || [];
      return schedule.times.some(t => userSlots.includes(t));
    });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Allow Vercel cron secret OR admin password for manual testing. The admin
  // path goes through the shared constant-time, rate-limited check; the cron
  // secret is compared the same way rather than with ===.
  const authHeader = req.headers.authorization;
  const adminPw    = req.headers['x-admin-password'];

  const cronOk = CRON_SECRET && typeof authHeader === 'string' &&
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(authHeader).digest(),
      crypto.createHash('sha256').update('Bearer ' + CRON_SECRET).digest()
    );

  if (!cronOk) {
    const denied = checkAdminPassword(req, adminPw);
    if (denied) return res.status(denied.status).json(denied.body);
  }

  const siteUrl = 'https://elpys.vercel.app';
  const todayIso = new Date().toISOString().slice(0, 10);

  // 1. New published opportunities in the last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oppRes = await fetch(
    SUPABASE_REST + 'Opportunities?status=eq.published&published_at=gte.' + since +
    '&select=id,name,description,slug,category,when,opportunity_type,event_date',
    { headers: supaHeaders() }
  );
  if (!oppRes.ok) return res.status(500).json({ error: 'Failed to fetch opportunities' });
  const opportunities = await oppRes.json();

  if (!opportunities.length) {
    return res.status(200).json({ ok: true, message: 'No new opportunities this week — digest skipped.' });
  }

  // 2. Subscribed users with at least one interest and a stored email
  const profilesRes = await fetch(
    SUPABASE_REST + 'profiles?unsubscribed=eq.false&interests=not.eq.%7B%7D&email=not.is.null&select=id,interests,email,availability',
    { headers: supaHeaders() }
  );
  if (!profilesRes.ok) return res.status(500).json({ error: 'Failed to fetch profiles' });
  const profiles = await profilesRes.json();

  if (!profiles.length) {
    return res.status(200).json({ ok: true, message: 'No subscribed users — digest skipped.' });
  }

  // 3. Build one digest per matching user, then send them
  //
  // Building and sending are separated on purpose. Building is pure string
  // work and costs nothing; sending is network-bound and is the only part
  // that can run out of time. Keeping them apart means the time budget below
  // governs sends alone, and a truncated run has an exact, reportable count
  // of what was left rather than stopping somewhere inside a loop that was
  // doing both.
  let sent = 0, skipped = 0;
  const failed = [];
  const jobs = [];

  for (const profile of profiles) {
    const to = profile.email;

    const interests = (Array.isArray(profile.interests) ? profile.interests : [])
      .map(i => i.toLowerCase());
    const matched   = opportunities.filter(opp => {
      if (!opp.category) return false;
      const cats = opp.category.split(/[,·]/).map(c => c.trim().toLowerCase()).filter(Boolean);
      if (!interests.some(i => cats.includes(i))) return false;
      if (opp.opportunity_type === 'one_time') {
        // No weekly pattern to match against availability — every interested,
        // subscribed user hears about it. Defensively skip one already past.
        return !opp.event_date || opp.event_date >= todayIso;
      }
      return availabilityMatches(_parseSchedule(opp.when), profile.availability);
    });

    if (!matched.length) { skipped++; continue; }

    const unsubUrl = siteUrl + '/api/unsubscribe?id=' + profile.id;

    const itemsHtml = matched.map(opp => {
      const url = siteUrl + '/' + encodeURIComponent(opp.slug || '');
      const dateLine = (opp.opportunity_type === 'one_time' && opp.event_date)
        ? '<p style="font-size:0.8125rem;font-weight:700;color:#111827;margin:0 0 0.4rem;">' + esc(formatDigestDate(opp.event_date)) + '</p>'
        : '';
      return (
        '<div style="border:1px solid #E5E7EB;border-radius:8px;padding:1rem 1.25rem;margin-bottom:0.75rem;">' +
          '<p style="font-size:1rem;font-weight:700;margin:0 0 0.3rem;color:#1A1A1A;">' + esc(opp.name) + '</p>' +
          dateLine +
          '<p style="font-size:0.875rem;color:#555;line-height:1.5;margin:0 0 0.6rem;">' + esc(opp.description || '') + '</p>' +
          '<a href="' + url + '" style="font-size:0.875rem;font-weight:600;color:#1A1A1A;text-decoration:none;">View opportunity →</a>' +
        '</div>'
      );
    }).join('');

    const html =
      '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;' +
      'background:#F7F7F7;margin:0;padding:2rem 1rem;">' +
      '<div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;border:1px solid #E5E7EB;">' +
        '<p style="font-size:1.25rem;font-weight:700;letter-spacing:-0.02em;margin:0 0 0.25rem;color:#1A1A1A;">Elpys</p>' +
        '<p style="font-size:0.875rem;color:#888;margin:0 0 1.75rem;">New volunteer opportunities matching your interests</p>' +
        itemsHtml +
        '<p style="font-size:0.875rem;color:#444;margin-top:1.5rem;line-height:1.55;">' +
          'Browse all opportunities at <a href="' + siteUrl + '" style="color:#1A1A1A;">' + siteUrl.replace('https://', '') + '</a>.' +
        '</p>' +
        '<hr style="border:none;border-top:1px solid #E5E7EB;margin:1.5rem 0;">' +
        '<p style="font-size:0.75rem;color:#888;margin:0;">' +
          'You\'re receiving this because you have an Elpys account with saved interests. ' +
          '<a href="' + unsubUrl + '" style="color:#888;">Unsubscribe</a>' +
        '</p>' +
      '</div></body></html>';

    const text =
      'New volunteer opportunities on Elpys\n\n' +
      matched.map(opp => {
        const url = siteUrl + '/' + encodeURIComponent(opp.slug || '');
        const datePrefix = (opp.opportunity_type === 'one_time' && opp.event_date) ? formatDigestDate(opp.event_date) + '\n' : '';
        return opp.name + '\n' + datePrefix + (opp.description || '') + '\n' + url;
      }).join('\n\n') +
      '\n\n---\nUnsubscribe: ' + unsubUrl;

    jobs.push({ to: to, html: html, text: text });
  }

  // ── Send phase ────────────────────────────────────────────────────────────
  //
  // This used to be a plain `await sendEmail(...)` inside the loop above: one
  // send at a time, under this function's maxDuration. That works fine at one
  // subscriber and dies somewhere around 20-40 — not with an error, but by
  // being killed mid-loop. Some people would get that week's digest, the rest
  // silently would not, and because the opportunity query keys off
  // published_at within the last 7 days, the next run would not cover them
  // either: the same tail can miss week after week with nothing to show for it.
  //
  // Three things changed. Sends now run CONCURRENCY at a time through the
  // pooled transport in lib/sendEmail.js (pool: true, created once at module
  // scope, so the connections are already there to reuse). This function's
  // maxDuration is raised to 60s in vercel.json — a per-function override, not
  // a change to the 10s the other endpoints get. And the run stops on its own
  // before the platform kills it, so a truncated run REPORTS itself instead of
  // vanishing.
  //
  // Gmail's own cap (~500 recipients/day on a consumer account) is now the
  // binding constraint rather than the timeout, which is the right way round:
  // it is a documented number rather than a cliff nobody sees coming.
  const CONCURRENCY = 4;
  const BUDGET_MS   = 50 * 1000;  // 60s limit, 10s of headroom for everything else
  const startedAt   = Date.now();
  let truncated     = false;

  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > BUDGET_MS) {
      truncated = true;
      break;
    }
    const batch = jobs.slice(i, i + CONCURRENCY);
    // allSettled, not all: one rejection must not abandon the rest of its own
    // batch, let alone the run.
    const results = await Promise.allSettled(batch.map(job =>
      sendEmail({ to: job.to, subject: 'New volunteer opportunities this week — Elpys', html: job.html, text: job.text })
    ));
    results.forEach((r, n) => {
      if (r.status === 'fulfilled') { sent++; return; }
      // One undeliverable address must not end the run. This used to return
      // straight out of the handler, so every remaining subscriber got nothing.
      const err = r.reason;
      console.error('Failed to send to', batch[n].to, err && err.message);
      failed.push({ to: batch[n].to, error: (err && err.message) || String(err) });
    });
  }

  if (truncated) {
    // Loud on purpose. A partial digest is the failure this whole restructure
    // exists to make visible — it is not an error the platform will report,
    // because nothing threw.
    console.error(
      'Digest TRUNCATED on time budget: sent ' + sent + ' of ' + jobs.length +
      ' built messages in ' + Math.round((Date.now() - startedAt) / 1000) + 's. ' +
      (jobs.length - sent - failed.length) + ' subscriber(s) got nothing this week. ' +
      'Raise CONCURRENCY, raise maxDuration, or move to a batch email provider.'
    );
  }

  if (failed.length) {
    console.error('Digest finished with ' + failed.length + ' failed send(s):', JSON.stringify(failed));
  }

  const unsent = jobs.length - sent - failed.length;

  return res.status(200).json({
    ok: !truncated,
    sent,
    skipped,
    failed: failed.length,
    built: jobs.length,
    unsent,
    truncated,
    totalProfiles: profiles.length,
    message: truncated
      ? 'TRUNCATED on time budget: sent ' + sent + ' of ' + jobs.length + ', ' + unsent + ' subscriber(s) got nothing. See logs.'
      : (failed.length
          ? 'Sent to ' + sent + ', skipped ' + skipped + ', ' + failed.length + ' failed to send (see logs).'
          : undefined),
  });
};

// This runs in a cron job rather than a viewer's browser, so it formats in UTC
// explicitly instead of borrowing whatever timezone the server happens to be in.
// Separate from supabase-client.js's copy — different process, no shared module.
function formatDigestDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
