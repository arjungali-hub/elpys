// Vercel serverless function — /api/analytics-review
//
// Backs the admin Analytics review page (analytics-review.html). Almost
// entirely read-only: GET returns the review data and status, and the one
// POST action (acknowledge-redesign-prompt) only ever sets the acknowledged_at
// field on one entry inside redesign_prompts — the scheduled task that
// writes everything else on the row (including every other field of that
// same entry) never touches it. Nothing else here writes.
//
// The rows come from a Cowork scheduled task ("Elpys Monthly Analytics
// Review") that runs on the first Monday of each month (not the 1st — those
// are the same date only four times a year), pulls PostHog traffic/vitals/
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

// A request that hangs rather than fails leaves whoever's awaiting it stuck
// until Vercel's own platform-level function timeout kills the whole
// invocation — which answers with a raw "Gateway Timeout" the client can't
// parse into anything useful, instead of a clean answer from our own code.
// Every Supabase call in this file goes through this rather than a bare
// fetch(), so a slow response fails fast and on our own terms.
function abortAfter(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// Same probe as api/review.js: a paused project refuses connections or answers
// 5xx, which is distinguishable from a bad key (401) or a missing table (404).
// Probing Opportunities rather than analytics_reviews on purpose — a brand new
// table with zero rows is not evidence of anything being wrong, so it makes a
// poor liveness signal.
async function probeSupabase() {
  const { signal, cancel } = abortAfter(8000);
  try {
    const r = await fetch(SUPABASE_URL + 'Opportunities?select=id&limit=1', {
      headers: supabaseHeaders(), signal,
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
    cancel();
  }
}

// Throws on a connectivity failure (network error, timeout, or a non-2xx
// response) rather than folding it into a null return. That distinction
// matters: null here means "queried fine, genuinely zero rows" — the real
// meaning of "never run" — and a caller that can't tell that apart from "the
// query itself failed" ends up showing "Never run" for a task that in fact
// ran recently and successfully, which is exactly what was observed live
// once during testing. The caller is responsible for telling those two
// apart in what it shows.
async function fetchTaskRun() {
  const { signal, cancel } = abortAfter(5000);
  let r;
  try {
    r = await fetch(
      SUPABASE_URL + 'task_runs?task_name=eq.' + encodeURIComponent(TASK_NAME) +
        '&select=task_name,last_run_at,status,note,updated_at',
      { headers: supabaseHeaders(), signal }
    );
  } catch (err) {
    const detail = err && err.name === 'AbortError' ? 'no response within 5s' : (err && err.message) || String(err);
    throw new Error('task_runs unreachable: ' + detail);
  } finally {
    cancel();
  }
  if (!r.ok) throw new Error('task_runs fetch failed: HTTP ' + r.status);

  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return null; // genuinely never run
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

// The first Monday of the given UTC month (0-indexed). Not the 1st — the
// task runs on the first Monday, and got this wrong once already: an earlier
// version of this function assumed the 1st, which is a different date in
// most months (September 2026's 1st is a Tuesday; its first Monday is the 7th).
function firstMondayOf(year, month) {
  const d = new Date(Date.UTC(year, month, 1));
  const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(1 + ((8 - dayOfWeek) % 7)); // 8-dayOfWeek mod 7 lands on Monday=1
  return d;
}

// The next first-Monday-of-a-month strictly after now, in UTC — the task's
// own schedule. Computed rather than hardcoded so the "never run" copy
// doesn't rot the moment the date it names has passed.
function nextRunLabel(now) {
  const d = now instanceof Date ? now : new Date();
  let next = firstMondayOf(d.getUTCFullYear(), d.getUTCMonth());
  if (next.getTime() <= d.getTime()) {
    next = firstMondayOf(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  return next.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

// Every not-yet-acknowledged entry in the most recent review row's
// redesign_prompts array, ranked best-first. redesign_prompts is a jsonb
// array (not null, defaults to '[]') — never null itself, but tolerate a
// missing/malformed value from a row written before this column existed.
function pendingRedesignPrompts(latestReview) {
  const prompts = (latestReview && Array.isArray(latestReview.redesign_prompts))
    ? latestReview.redesign_prompts
    : [];
  return prompts
    .filter(p => p && p.acknowledged_at == null)
    .sort((a, b) => a.rank - b.rank);
}

// The traffic light this page and the admin header dot both render — same
// {dot, label, detail} shape computeStatus() returns in api/review.js, plus
// pendingRedesignPrompts so callers don't have to re-derive it from raw row
// fields. latestReview is the most recent analytics_reviews row (or null) —
// only its redesign_prompts field is read here.
function computeStatus(supabase, taskRun, latestReview, now) {
  const pending = pendingRedesignPrompts(latestReview);

  if (supabase.state !== 'active') {
    return {
      dot: 'red',
      label: supabase.state === 'paused' ? 'Supabase is paused' : 'Supabase is unreachable',
      detail: (supabase.detail ? supabase.detail + ' ' : '') +
        'Restore it from the Supabase dashboard soon — a project left paused too long is deleted, ' +
        'not just parked. No analytics review can be read or written until it is running again.',
      pendingRedesignPrompts: pending,
    };
  }

  if (!taskRun) {
    return {
      dot: 'unknown',
      label: 'Never run',
      detail: 'The first monthly review runs ' + nextRunLabel(now) + '.',
      pendingRedesignPrompts: pending,
    };
  }

  // A broken task is worse than a pending suggestion — failed stays red no
  // matter how many entries are waiting in redesign_prompts.
  if (taskRun.status === 'failed') {
    return {
      dot: 'red',
      label: 'Last run failed',
      detail: taskRun.note || 'No details recorded.',
      pendingRedesignPrompts: pending,
    };
  }

  let existingYellow = null;
  if (taskRun.status === 'degraded') {
    existingYellow = {
      label: 'Last run degraded',
      detail: taskRun.note ||
        'The run finished but reported a problem, and no note was recorded. The figures below may be incomplete.',
    };
  } else if (taskRun.ageDays !== null && taskRun.ageDays > REVIEW_STALE_DAYS) {
    existingYellow = {
      label: 'Overdue',
      detail: 'Last successful run was ' + taskRun.ageDays +
        (taskRun.ageDays === 1 ? ' day' : ' days') + ' ago. Expected monthly.',
    };
  }

  // One or more pending redesign prompts is a second, independent reason to
  // go yellow. Never let it get silently absorbed into an unrelated
  // degraded/overdue reason — either it's the only reason (its own label,
  // which scales with count), or it rides along in the detail of whichever
  // existing reason applies.
  if (existingYellow || pending.length) {
    const pendingSummary = pending.length === 1
      ? pending[0].title
      : pending.map(p => p.title).join('; ');

    if (existingYellow && pending.length) {
      return {
        dot: 'yellow',
        label: existingYellow.label,
        detail: existingYellow.detail +
          ' Also: a redesign suggestion is ready — ' + pendingSummary,
        pendingRedesignPrompts: pending,
      };
    }
    if (existingYellow) {
      return { dot: 'yellow', label: existingYellow.label, detail: existingYellow.detail, pendingRedesignPrompts: pending };
    }
    return {
      dot: 'yellow',
      label: pending.length === 1 ? 'Redesign suggestion ready' : pending.length + ' redesign suggestions ready',
      detail: pendingSummary,
      pendingRedesignPrompts: pending,
    };
  }

  // Deliberately does not repeat the run date: the page prints the exact
  // timestamp on its own line directly below this one, and saying it twice in
  // two different formats reads as a rendering mistake.
  return {
    dot: 'green',
    label: 'Running on schedule',
    detail: 'The monthly analytics task reported success on its last run.',
    pendingRedesignPrompts: pending,
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

// Lightweight companion to the full `select=*` fetch below — used only for
// ?summary=1, which colours one dot and should not need 12 rows of metrics
// to do it (same reasoning as the full fetch being skipped there already).
async function fetchLatestReviewSummary() {
  const { signal, cancel } = abortAfter(5000);
  try {
    const r = await fetch(
      SUPABASE_URL + 'analytics_reviews?select=id,redesign_prompts&order=period_end.desc&limit=1',
      { headers: supabaseHeaders(), signal }
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => null);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (_) {
    // Best-effort only: a summary request that can't fetch this loses the
    // redesign-prompt yellow reason but still answers with whatever the rest
    // of the status can tell honestly, rather than failing the whole request
    // over one extra, non-essential column.
    return null;
  } finally {
    cancel();
  }
}

async function handleAnalyticsReview(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // ── POST — the one write action this page has: acknowledging a single
  // entry inside a row's redesign_prompts array. Everything else about this
  // page stays read-only, by design. ──────────────────────────────────────
  if (req.method === 'POST') {
    const { action, review_id, prompt_id } = req.body || {};
    if (action !== 'acknowledge-redesign-prompt') {
      return res.status(400).json({ error: 'Unknown action.' });
    }

    const reviewIdNum = Number(review_id);
    if (!Number.isInteger(reviewIdNum) || reviewIdNum <= 0) {
      return res.status(400).json({ error: 'review_id must be a positive integer.' });
    }
    if (typeof prompt_id !== 'string' || !prompt_id.trim()) {
      return res.status(400).json({ error: 'prompt_id must be a non-empty string.' });
    }

    const rowRes = await fetch(
      SUPABASE_URL + 'analytics_reviews?id=eq.' + reviewIdNum + '&select=id,redesign_prompts',
      { headers: supabaseHeaders() }
    );
    if (!rowRes.ok) {
      const body = await readJson(rowRes);
      return res.status(500).json(failure('Could not load the review row.', rowRes.status, body.text, body.parsed));
    }
    const rows = await rowRes.json().catch(() => null);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) {
      return res.status(404).json({ error: 'No review matched id ' + reviewIdNum + '.' });
    }

    const prompts = Array.isArray(row.redesign_prompts) ? row.redesign_prompts : [];
    const target = prompts.find(p => p && p.id === prompt_id);
    if (!target) {
      return res.status(404).json({ error: 'No redesign prompt matched id ' + prompt_id + ' on that review.' });
    }

    // Already acknowledged — a double-click or a stale tab, not an error.
    // Every other entry's order/rank/fields are already untouched since
    // nothing is being written in this branch.
    if (target.acknowledged_at != null) {
      return res.status(200).json({ ok: true });
    }

    // Only the one matching element changes; every other element (and its
    // position in the array) is written back exactly as it was read.
    const updatedPrompts = prompts.map(p =>
      (p && p.id === prompt_id) ? Object.assign({}, p, { acknowledged_at: new Date().toISOString() }) : p
    );

    const r = await fetch(
      SUPABASE_URL + 'analytics_reviews?id=eq.' + reviewIdNum,
      {
        method:  'PATCH',
        headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify({ redesign_prompts: updatedPrompts }),
      }
    );
    if (!r.ok) {
      const body = await readJson(r);
      return res.status(500).json(failure('Could not update the review row.', r.status, body.text, body.parsed));
    }
    return res.status(200).json({ ok: true });
  }

  // ── GET from here down ──────────────────────────────────────────────────
  const summaryOnly = req.query && (req.query.summary === '1' || req.query.summary === 'true');
  const supabase = await probeSupabase();

  if (supabase.state !== 'active') {
    const status = computeStatus(supabase, null, null);
    return res.status(200).json(summaryOnly
      ? { supabase, status, pendingRedesignPrompts: status.pendingRedesignPrompts }
      : { supabase, status, taskRun: null, reviews: [], pendingRedesignPrompts: status.pendingRedesignPrompts });
  }

  let taskRun;
  try {
    taskRun = await fetchTaskRun();
  } catch (err) {
    // Distinct from "never run": the query itself failed (network blip,
    // timeout, a bad response) rather than answering with zero rows. Saying
    // "Never run" here would be actively wrong for a task that in fact ran
    // recently and successfully — this is what showed up during testing.
    console.error('/api/analytics-review: could not check task_runs —', err && err.message);
    const status = {
      dot: 'unknown',
      label: 'Could not check',
      detail: 'The monthly task\'s run history could not be reached just now. ' +
        'This does not mean the task failed to run — try reloading in a moment.',
      pendingRedesignPrompts: [],
    };
    return res.status(200).json(summaryOnly
      ? { supabase, status, pendingRedesignPrompts: status.pendingRedesignPrompts }
      : { supabase, status, taskRun: null, reviews: [], pendingRedesignPrompts: status.pendingRedesignPrompts });
  }

  // ?summary=1 — just the traffic light, for the admin header dot. Pulling 12
  // rows of metrics to colour one dot would be wasteful, same reasoning as
  // /api/review?summary=1 — but the dot's new yellow reason needs the most
  // recent row's redesign_prompts field, so fetch that one column for one
  // row rather than skipping the review table entirely.
  if (summaryOnly) {
    const latestReview = await fetchLatestReviewSummary();
    const status = computeStatus(supabase, taskRun, latestReview);
    return res.status(200).json({ supabase, status, pendingRedesignPrompts: status.pendingRedesignPrompts });
  }

  const { signal: reviewsSignal, cancel: cancelReviews } = abortAfter(6000);
  let r, body;
  try {
    r = await fetch(
      SUPABASE_URL + 'analytics_reviews?select=*&order=period_end.desc&limit=' + REVIEW_LIMIT,
      { headers: supabaseHeaders(), signal: reviewsSignal }
    );
    body = await readJson(r);
  } catch (err) {
    const detail = err && err.name === 'AbortError' ? 'no response within 6s' : (err && err.message) || String(err);
    return res.status(500).json(failure('Could not load analytics reviews.', null, detail, null));
  } finally {
    cancelReviews();
  }
  if (!r.ok) {
    return res.status(500).json(failure('Could not load analytics reviews.', r.status, body.text, body.parsed));
  }

  const reviews = Array.isArray(body.parsed) ? body.parsed : [];
  const status  = computeStatus(supabase, taskRun, reviews[0] || null);

  return res.status(200).json({
    supabase,
    status,
    taskRun,
    reviews,
    pendingRedesignPrompts: status.pendingRedesignPrompts,
  });
}
