// Review alerts — emails the Elpys inbox (hello.elpys@gmail.com) when
// something NEW needs doing in Data review (/review) or Analytics review
// (/analytics-review).
// Triggered daily by Vercel cron (Authorization: Bearer $CRON_SECRET), or by
// hand with the admin password (x-admin-password header). ?dry=1 reports what
// it would send without sending or remembering anything.
//
// Both queues are written by Cowork scheduled tasks straight into Supabase,
// not through this repo, so nothing here sees an item arrive; this checks
// once a day instead (the Vercel plan allows at most daily cron jobs). It asks
// exactly what the two pages' own traffic lights ask — computeStatus() and
// friends are imported from api/review.js and api/analytics-review.js — so an
// email and the yellow/red dot always agree:
//   Data review       a flag waiting on a decision (status pending, no
//                     human_decision yet); the weekly or local check failed or
//                     overdue; Supabase paused or unreachable.
//   Analytics review  a redesign suggestion not yet acknowledged; the monthly
//                     run failed, degraded or overdue.
//
// Each item has a key (flag:<id>, prompt:<review>:<id>, or a reason plus the
// run time it's about). The keys present at the last successful email are
// kept in task_runs (task_name 'review_alerts', in note), so an item is
// emailed once when it appears, not every day while it waits. An item that
// clears and comes back is new again. State is saved only after the email is
// sent, so a failed send is retried by the next day's run. Supabase being
// down is keyed by date: that one repeats daily until it's fixed.

const crypto = require('crypto');
const { checkAdminPassword } = require('../lib/adminAuth');
const sendEmail = require('../lib/sendEmail');
const { layout, esc, within, ALERT_TO, SITE } = require('../lib/adminAlert');
const review    = require('./review');
const analytics = require('./analytics-review');

function restBase(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u.endsWith('/')) u += '/';
  if (!/\/rest\/v1\/$/.test(u)) u += 'rest/v1/';
  return u;
}

const SUPABASE_URL = restBase(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const STATE_TASK   = 'review_alerts';

function supabaseHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
}

async function getJson(path) {
  const r = await fetch(SUPABASE_URL + path, { headers: supabaseHeaders() });
  if (!r.ok) throw new Error(path.split('?')[0] + ' read failed (HTTP ' + r.status + ')');
  return r.json();
}

// Everything that currently needs doing, as [{ key, area, text }].
async function collectItems() {
  const items = [];
  const supabase = await review.probeSupabase();
  if (supabase.state !== 'active') {
    const st = review.computeStatus(supabase, 0, { cloudWeekly: null, localVerify: null });
    items.push({ key: 'supabase:' + new Date().toISOString().slice(0, 10), area: 'data', text: st.label + '. ' + st.detail });
    return items;
  }

  // Data review: flags waiting on a decision.
  const flags = await getJson('data_review_flags?status=eq.pending&human_decision=is.null' +
    '&select=id,opportunity_id,field,issue_summary&order=id.asc');
  const ids = [...new Set(flags.map(f => f.opportunity_id).filter(v => v != null))];
  const names = {};
  if (ids.length) {
    (await getJson('Opportunities?id=in.(' + ids.join(',') + ')&select=id,name')).forEach(o => { names[o.id] = o.name; });
  }
  flags.forEach(f => items.push({
    key: 'flag:' + f.id, area: 'data',
    text: (names[f.opportunity_id] || 'Listing #' + f.opportunity_id) + (f.field ? ' (' + f.field + ')' : '') + ': ' +
          (f.issue_summary || 'flag waiting on your decision'),
  }));

  // Data review: the two safety nets. awaitingHuman is passed as 0 so the
  // status reflects only their health (flags are listed one by one above).
  const runs = await review.fetchTaskRuns();
  const dataHealth = review.computeStatus(supabase, 0, runs);
  if (dataHealth.dot !== 'green') {
    items.push({
      key: 'data:' + dataHealth.label + ':' + (runs.cloudWeekly ? runs.cloudWeekly.lastRunAt : '-') + ':' +
           (runs.localVerify ? runs.localVerify.lastRunAt : '-'),
      area: 'data', text: dataHealth.label + '. ' + dataHealth.detail,
    });
  }

  // Analytics review: the monthly run's health, then pending suggestions.
  let taskRun;
  try { taskRun = await analytics.fetchTaskRun(); } catch (err) { throw new Error('task_runs: ' + err.message); }
  const health = analytics.computeStatus(supabase, taskRun, null, new Date());
  if (health.dot === 'red' || health.dot === 'yellow') {
    items.push({ key: 'analytics:' + health.label + ':' + (taskRun ? taskRun.lastRunAt : '-'), area: 'analytics',
                 text: health.label + '. ' + health.detail });
  }
  const latest = await analytics.fetchLatestReviewSummary();
  const pending = analytics.computeStatus(supabase, taskRun, latest, new Date()).pendingRedesignPrompts || [];
  pending.forEach(p => items.push({ key: 'prompt:' + (latest && latest.id) + ':' + p.id, area: 'analytics',
                                    text: 'Redesign suggestion ready: ' + (p.title || 'untitled') }));
  return items;
}

async function readState() {
  const rows = await getJson('task_runs?task_name=eq.' + STATE_TASK + '&select=note');
  if (!rows.length) return [];
  try { const keys = JSON.parse(rows[0].note || '[]'); return Array.isArray(keys) ? keys : []; } catch (_) { return []; }
}

async function saveState(keys, note) {
  const now = new Date().toISOString();
  const r = await fetch(SUPABASE_URL + 'task_runs?on_conflict=task_name', {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ task_name: STATE_TASK, last_run_at: now, updated_at: now, status: 'ok', note: JSON.stringify(keys) }),
  });
  if (!r.ok) console.error('review-alerts: could not save state (HTTP ' + r.status + '); tomorrow may repeat today\'s email.', note || '');
}

function buildEmail(fresh) {
  const data = fresh.filter(i => i.area === 'data'), an = fresh.filter(i => i.area === 'analytics');
  const n = fresh.length;
  const where = data.length && an.length ? 'Data review and Analytics review' : data.length ? 'Data review' : 'Analytics review';
  const section = (title, list, href) => !list.length ? '' :
    '<p style="font-size:0.95rem;font-weight:600;color:#1A1A1A;margin:0 0 0.5rem;">' + esc(title) + '</p>' +
    '<ul style="font-size:0.95rem;color:#1A1A1A;line-height:1.55;margin:0 0 0.75rem;padding-left:1.2rem;">' +
      list.map(i => '<li>' + esc(i.text) + '</li>').join('') + '</ul>' +
    '<p style="margin:0 0 1.5rem;"><a href="' + esc(href) + '" style="color:#1A1A1A;">Open ' + esc(title) + '</a></p>';
  const html = layout({ heading: n === 1 ? 'One new thing needs you.' : n + ' new things need you.' })
    .replace('</div></body></html>',
      section('Data review', data, SITE + '/review') + section('Analytics review', an, SITE + '/analytics-review') + '</div></body></html>');
  const textSection = (title, list, href) => !list.length ? '' :
    title + '\n' + list.map(i => '- ' + i.text).join('\n') + '\n' + href + '\n\n';
  return {
    subject: 'Elpys: ' + (n === 1 ? '1 new item' : n + ' new items') + ' in ' + where,
    html,
    text: textSection('Data review', data, SITE + '/review') + textSection('Analytics review', an, SITE + '/analytics-review'),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const authHeader = req.headers.authorization;
  const cronOk = CRON_SECRET && typeof authHeader === 'string' &&
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(authHeader).digest(),
      crypto.createHash('sha256').update('Bearer ' + CRON_SECRET).digest()
    );
  if (!cronOk) {
    const denied = checkAdminPassword(req, req.headers['x-admin-password']);
    if (denied) return res.status(denied.status).json(denied.body);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Server is missing its Supabase settings.' });
  const dryRun = req.query && (req.query.dry === '1' || req.query.dry === 'true');

  let items, previous;
  try {
    items = await collectItems();
    previous = items.some(i => i.key.startsWith('supabase:')) ? [] : await readState();
  } catch (err) {
    console.error('review-alerts: could not check —', err.message);
    return res.status(502).json({ error: err.message + '. No email sent.' });
  }
  const seen = new Set(previous);
  const fresh = items.filter(i => !seen.has(i.key));
  const keys = items.map(i => i.key);

  if (dryRun) return res.status(200).json({ ok: true, dryRun: true, current: items, wouldEmail: fresh });
  if (!fresh.length) {
    // Still remember the current set, so an item that cleared and comes back
    // later counts as new again.
    if (!items.some(i => i.key.startsWith('supabase:'))) await saveState(keys);
    return res.status(200).json({ ok: true, emailed: 0, current: items.length });
  }

  const mail = buildEmail(fresh);
  let failed = null;
  const sending = sendEmail({ to: ALERT_TO, subject: mail.subject, html: mail.html, text: mail.text })
    .catch(err => { failed = err; });
  const done = await within(sending, 8000);
  if (!done || failed) {
    console.error('review-alerts: email not sent —', failed ? (failed.message || failed) : 'timed out');
    return res.status(502).json({ error: 'Email could not be sent; will retry on the next run.' });
  }
  if (!items.some(i => i.key.startsWith('supabase:'))) await saveState(keys);
  console.log('review-alerts: emailed', fresh.length, 'new item(s):', fresh.map(i => i.key).join(', '));
  return res.status(200).json({ ok: true, emailed: fresh.length, current: items.length });
};

module.exports._buildEmail = buildEmail;
