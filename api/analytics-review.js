// Vercel serverless function — /api/analytics-review
//
// Backs the admin Analytics review page (analytics-review.html). Read-only:
// GET (and OPTIONS) only, no POST — nothing on that page edits anything.
//
// The rows come from a Cowork scheduled task ("Elpys Monthly Analytics
// Review") that runs on the 1st of each month, pulls PostHog traffic/vitals/
// signup-click figures, writes one analytics_reviews row, and upserts a
// task_runs heartbeat under task_name = 'analytics_review_monthly'. Nothing
// in this repo writes either table; this endpoint only reads them.
//
// Structure deliberately mirrors api/review.js — same restBase() tolerance,
// the same probe, the same {dot,label,detail} status shape — so the two admin
// utility endpoints stay recognisably the same thing.
//
// Required environment variables (set in Vercel project settings):
//   SUPABASE_URL               e.g. https://xxxx.supabase.co/rest/v1/
//   SUPABASE_SERVICE_ROLE_KEY  the service_role secret from Supabase → Settings → API
//   ADMIN_PASSWORD             same secret the rest of the admin surface uses

// Tolerates SUPABASE_URL given with or without the /rest/v1/ suffix; without it
// every query below would silently 404.
function restBase(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u.endsWith('/')) u += '/';
  if (!/\/rest\/v1\/$/.test(u)) u += 'rest/v1/';
  return u;
}

const { checkAdminPassword, adminSessionCookie } = require('../lib/adminAuth');

const SUPABASE_URL = restBase(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TASK_NAME     = 'analytics_review_monthly';
const REVIEW_LIMIT  = 12;

// 30-day cadence plus 15 days' grace. A cron that silently stops — task
// disabled, account issue, integration revoked — produces no failure row and
// no error anywhere; the ONLY symptom is that last_run_at quietly stops
// moving. This threshold is the one thing that turns that silence into a
// visible yellow dot, so it matters more than it looks.
const REVIEW_STALE_DAYS = 45;

function supabaseHeaders(extra) {
  return Object.assign({
    apikey:        SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  }, extra);
}

async function readJson(r) {
  const text = await r.text().catch(() => '');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }
  return { text, parsed };
}

function failure(label, status, text, parsed) {
  console.error(label, status, text);
  return {
    error:          label,
    supabaseStatus: status,
    message:        (parsed && parsed.message) || String(text || '').slice(0, 500) || null,
    details:        (parsed && parsed.details) || null,
    hint:           (parsed && parsed.hint)    || null,
    code:           (parsed && parsed.code)    || null,
  };
}

// Same probe as api/review.js: a paused project refuses connections or answers
// 5xx, which is distinguishable from a bad key (401) or a missing table (404).
// Probing Opportunities rather than analytics_reviews on purpose — a brand new
// table with zero rows is not evidence of anything being wrong, so it makes a
// poor liveness signal.
async function probeSupabase() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(SUPABASE_URL + 'Opportunities?select=id&limit=1', {
      headers: supabaseHeaders(), signal: controller.signal,
    });
    if (r.ok) return { state: 'active', detail: null };
    const body = await readJson(r);
    const message = (body.parsed && body.parsed.message) || String(body.text || '').slice(0, 200) || null;
    if (r.status >= 500) return { state: 'paused', detail: 'HTTP ' + r.status + (message ? ' — ' + message : '') };
    return { state: 'error', detail: 'HTTP ' + r.status + (message ? ' — ' + message : '') };
  } catch (err) {
    const detail = err && err.name === 'AbortError' ? 'No response within 8s' : (err && err.message) || String(err);
    return { state: 'paused', detail: detail };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTaskRun() {
  const r = await fetch(
    SUPABASE_URL + 'task_runs?task_name=eq.' + encodeURIComponent(TASK_NAME) +
      '&select=task_name,last_run_at,status,note,updated_at',
    { headers: supabaseHeaders() }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  const t = new Date(row.last_run_at).getTime();
  return {
    taskName:  row.task_name,
    status:    row.status,
    note:      row.note,
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
    ageDays:   isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null,
  };
}

// First of the month after today, in UTC — the task's own schedule. Computed
// rather than hardcoded so the "never run" copy doesn't rot the moment the
// date it names has passed.
function nextRunLabel(now) {
  const d = now instanceof Date ? now : new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

// The traffic light this page and the admin header dot both render — same
// {dot, label, detail} shape computeStatus() returns in api/review.js.
function computeStatus(supabase, taskRun, now) {
  if (supabase.state !== 'active') {
    return {
      dot: 'red',
      label: supabase.state === 'paused' ? 'Supabase is paused' : 'Supabase is unreachable',
      detail: (supabase.detail ? supabase.detail + ' ' : '') +
        'Restore it from the Supabase dashboard soon — a project left paused too long is deleted, ' +
        'not just parked. No analytics review can be read or written until it is running again.',
    };
  }

  if (!taskRun) {
    return {
      dot: 'unknown',
      label: 'Never run',
      detail: 'The first monthly review runs ' + nextRunLabel(now) + '.',
    };
  }

  if (taskRun.status === 'failed') {
    return {
      dot: 'red',
      label: 'Last run failed',
      detail: taskRun.note || 'No details recorded.',
    };
  }

  if (taskRun.status === 'degraded') {
    return {
      dot: 'yellow',
      label: 'Last run degraded',
      detail: taskRun.note ||
        'The run finished but reported a problem, and no note was recorded. The figures below may be incomplete.',
    };
  }

  if (taskRun.ageDays !== null && taskRun.ageDays > REVIEW_STALE_DAYS) {
    return {
      dot: 'yellow',
      label: 'Overdue',
      detail: 'Last successful run was ' + taskRun.ageDays +
        (taskRun.ageDays === 1 ? ' day' : ' days') + ' ago. Expected monthly.',
    };
  }

  return {
    dot: 'green',
    label: 'Running on schedule',
    detail: 'Last run ' + new Date(taskRun.lastRunAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }) + '.',
  };
}

module.exports = async function handler(req, res) {
  try {
    return await handleAnalyticsReview(req, res);
  } catch (err) {
    console.error('/api/analytics-review unhandled error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      error:   'Analytics review request failed.',
      message: err && err.message ? err.message : String(err),
    });
  }
};

async function handleAnalyticsReview(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const denied = checkAdminPassword(req, req.headers['x-admin-password']);
  if (denied) return res.status(denied.status).json(denied.body);

  // See adminSessionCookie's comment in lib/adminAuth.js — keeps middleware.js
  // letting analytics-review.html through for an active admin session.
  const cookie = adminSessionCookie();
  if (cookie) res.setHeader('Set-Cookie', cookie);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('/api/analytics-review misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({
      error:   'Analytics review request failed.',
      message: 'Server is missing Supabase configuration (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

  const summaryOnly = req.query && (req.query.summary === '1' || req.query.summary === 'true');
  const supabase = await probeSupabase();

  if (supabase.state !== 'active') {
    const status = computeStatus(supabase, null);
    return res.status(200).json(summaryOnly
      ? { supabase, status }
      : { supabase, status, taskRun: null, reviews: [] });
  }

  const taskRun = await fetchTaskRun();
  const status  = computeStatus(supabase, taskRun);

  // ?summary=1 — just the traffic light, for the admin header dot. Pulling 12
  // rows of metrics to colour one dot would be wasteful, same reasoning as
  // /api/review?summary=1.
  if (summaryOnly) return res.status(200).json({ supabase, status });

  const r = await fetch(
    SUPABASE_URL + 'analytics_reviews?select=*&order=period_end.desc&limit=' + REVIEW_LIMIT,
    { headers: supabaseHeaders() }
  );
  const body = await readJson(r);
  if (!r.ok) {
    return res.status(500).json(failure('Could not load analytics reviews.', r.status, body.text, body.parsed));
  }

  return res.status(200).json({
    supabase,
    status,
    taskRun,
    reviews: Array.isArray(body.parsed) ? body.parsed : [],
  });
}
