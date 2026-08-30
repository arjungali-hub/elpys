// Vercel serverless function — /api/review
//
// Backs the admin Data Review queue (review.html). data_review_flags has RLS on
// with no public policies, so every read and write here goes through the
// service role key, server-side — the same pattern as /api/admin.
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

const { checkAdminPassword } = require('../lib/adminAuth');

const SUPABASE_URL = restBase(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RESOLVED_LIMIT = 20;
const DECISIONS = ['change_needed', 'fine_as_is'];

// Cadence the two automated safety nets are expected to run on. The cloud
// check is weekly; a run older than this plus a few days' grace means it
// missed a cycle. The local check is monthly AND only fires when the site
// owner's own machine happens to be on, so its normal gap is 4-7 weeks —
// this threshold is set well past that, to flag only genuine abandonment.
const CLOUD_WEEKLY_STALE_DAYS = 10;
const LOCAL_VERIFY_STALE_DAYS = 70;

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

// Is the Supabase project reachable? A paused project refuses connections or
// answers 5xx, which is distinguishable from a bad key (401) or a missing table
// (404) — those are reported as 'error' rather than silently called "paused".
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

// Health of the two automated safety nets, read straight from task_runs.
// task_runs.task_name = 'cloud_weekly' is upserted by the weekly cloud check
// every run, whatever the outcome; 'local_verify' is upserted by the monthly
// local browser check. This table is the intended source for this dot — it
// used to be driven by a guess about database write recency instead, which
// misread an ordinary quiet week (no new submissions, no flag decisions) as
// "about to pause," even though the project was active and being served the
// whole time.
async function fetchTaskRuns() {
  const r = await fetch(
    SUPABASE_URL + 'task_runs?task_name=in.(cloud_weekly,local_verify)&select=task_name,last_run_at,status,note',
    { headers: supabaseHeaders() }
  );
  if (!r.ok) return { cloudWeekly: null, localVerify: null };
  const rows = await r.json().catch(() => null);
  const byName = {};
  (Array.isArray(rows) ? rows : []).forEach(row => { byName[row.task_name] = row; });

  function normalize(row) {
    if (!row) return null;
    const t = new Date(row.last_run_at).getTime();
    return {
      status:    row.status,
      note:      row.note,
      lastRunAt: row.last_run_at,
      ageDays:   isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null,
    };
  }

  return { cloudWeekly: normalize(byName.cloud_weekly), localVerify: normalize(byName.local_verify) };
}

// The single traffic light the admin header and the Data review page both
// show. Most urgent wins:
//   red    — Supabase is unreachable right now, confirmed by a live probe.
//            This is the state that actually starts the clock toward
//            Supabase's real failure mode: a project left paused too long is
//            DELETED, not just parked. This app has no way to know the exact
//            day count — that lives in the weekly cloud check's own log —
//            so the detail below points there rather than guessing a number.
//   yellow — one of the automated safety nets looks unhealthy, or flags are
//            waiting on a human decision.
//   green  — nothing waiting, and both checks look healthy.
function computeStatus(supabase, awaitingHuman, taskRuns) {
  if (supabase.state !== 'active') {
    return {
      dot: 'red',
      label: supabase.state === 'paused' ? 'Supabase is paused' : 'Supabase is unreachable',
      detail: (supabase.detail ? supabase.detail + ' ' : '') +
        'Restore it from the Supabase dashboard soon — a project left paused too long is deleted, ' +
        'not just parked. Check the weekly cloud report for exactly how many days it has been down.',
    };
  }

  const cw = taskRuns.cloudWeekly;
  if (!cw) {
    return {
      dot: 'yellow',
      label: 'Weekly check has never reported in',
      detail: 'No record yet from the automated weekly Supabase check (task_runs has no cloud_weekly row).',
    };
  }
  if (cw.status === 'failed' || (cw.ageDays !== null && cw.ageDays > CLOUD_WEEKLY_STALE_DAYS)) {
    return {
      dot: 'yellow',
      label: cw.status === 'failed' ? 'Weekly check failed' : 'Weekly check is overdue',
      detail: (cw.note || 'No note recorded.') +
        ' (last ran ' + cw.ageDays + (cw.ageDays === 1 ? ' day' : ' days') + ' ago)',
    };
  }

  if (awaitingHuman > 0) {
    return {
      dot: 'yellow',
      label: awaitingHuman + (awaitingHuman === 1 ? ' flag needs review' : ' flags need review'),
      detail: 'The weekly accuracy check raised these and is waiting on your decision.',
    };
  }

  const lv = taskRuns.localVerify;
  if (lv && lv.ageDays !== null && lv.ageDays > LOCAL_VERIFY_STALE_DAYS) {
    return {
      dot: 'yellow',
      label: 'Local browser check is overdue',
      detail: 'Last ran ' + lv.ageDays + ' days ago. It only runs when your computer is on, so an ' +
              'occasional multi-week gap is normal — this is well past that.',
    };
  }

  return {
    dot: 'green',
    label: 'All clear',
    detail: 'Nothing waiting on you, and both automated checks look healthy.',
  };
}

module.exports = async function handler(req, res) {
  try {
    return await handleReview(req, res);
  } catch (err) {
    console.error('/api/review unhandled error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      error:   'Data review request failed.',
      message: err && err.message ? err.message : String(err),
    });
  }
};

async function handleReview(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const denied = checkAdminPassword(req, req.headers['x-admin-password']);
  if (denied) return res.status(denied.status).json(denied.body);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('/api/review misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({
      error:   'Data review request failed.',
      message: 'Server is missing Supabase configuration (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

  // ── GET — pending queue + recently resolved ─────────────────────────────────
  if (req.method === 'GET') {
    // Supabase pauses free projects after inactivity, and a paused project fails
    // every REST call. Probe a known table first so the page can report "paused"
    // rather than dying on the flag queries with a generic error.
    const supabase = await probeSupabase();

    // ?summary=1 — just the traffic light for the admin header. Loading the
    // whole queue on every admin page to colour one dot would be wasteful.
    const summaryOnly = req.query && (req.query.summary === '1' || req.query.summary === 'true');

    if (supabase.state !== 'active') {
      const status = computeStatus(supabase, 0, { cloudWeekly: null, localVerify: null });
      return res.status(200).json(summaryOnly
        ? { supabase, status, awaitingHuman: 0, awaitingRun: 0 }
        : { supabase, status, pending: [], decided: [], resolved: [] });
    }

    if (summaryOnly) {
      // Counts come back in the Content-Range header, so no rows cross the wire.
      async function countOf(filter) {
        const r = await fetch(SUPABASE_URL + 'data_review_flags?' + filter + '&select=id&limit=1',
          { headers: supabaseHeaders({ Prefer: 'count=exact' }) });
        if (!r.ok) return 0;
        const range = r.headers.get('content-range') || '';
        const total = parseInt(String(range).split('/')[1], 10);
        return isFinite(total) ? total : 0;
      }

      const [awaitingHuman, awaitingRun, taskRuns] = await Promise.all([
        countOf('status=eq.pending&human_decision=is.null'),
        countOf('status=eq.pending&human_decision=not.is.null'),
        fetchTaskRuns(),
      ]);

      return res.status(200).json({
        supabase,
        awaitingHuman,
        awaitingRun,
        taskRuns,
        status: computeStatus(supabase, awaitingHuman, taskRuns),
      });
    }

    const [pendingRes, resolvedRes] = await Promise.all([
      fetch(SUPABASE_URL + 'data_review_flags?status=eq.pending&select=*&order=last_flagged_at.desc.nullslast,created_at.desc',
        { headers: supabaseHeaders() }),
      fetch(SUPABASE_URL + 'data_review_flags?status=eq.resolved&select=*&order=resolved_at.desc.nullslast&limit=' + RESOLVED_LIMIT,
        { headers: supabaseHeaders() }),
    ]);

    const pendingBody  = await readJson(pendingRes);
    const resolvedBody = await readJson(resolvedRes);

    if (!pendingRes.ok)  return res.status(500).json(failure('Could not load pending flags.',  pendingRes.status,  pendingBody.text,  pendingBody.parsed));
    if (!resolvedRes.ok) return res.status(500).json(failure('Could not load resolved flags.', resolvedRes.status, resolvedBody.text, resolvedBody.parsed));

    const pending  = Array.isArray(pendingBody.parsed)  ? pendingBody.parsed  : [];
    const resolved = Array.isArray(resolvedBody.parsed) ? resolvedBody.parsed : [];

    // Resolve opportunity names with a second query rather than a PostgREST
    // embed: embedding depends on the FK being exposed in the schema cache, and
    // a flag whose opportunity was deleted should still be reviewable.
    const ids = [];
    pending.concat(resolved).forEach(f => {
      if (f.opportunity_id != null && ids.indexOf(f.opportunity_id) === -1) ids.push(f.opportunity_id);
    });

    const names = {};
    if (ids.length) {
      const inList = '(' + ids.map(id => '"' + String(id).replace(/"/g, '') + '"').join(',') + ')';
      const oppRes = await fetch(
        SUPABASE_URL + 'Opportunities?id=in.' + encodeURIComponent(inList) + '&select=id,name,slug,status',
        { headers: supabaseHeaders() }
      );
      const oppBody = await readJson(oppRes);
      if (oppRes.ok && Array.isArray(oppBody.parsed)) {
        oppBody.parsed.forEach(o => { names[o.id] = { name: o.name, slug: o.slug, status: o.status }; });
      } else {
        // Non-fatal: the queue is still usable with ids only.
        console.error('Could not load opportunity names:', oppRes.status, oppBody.text);
      }
    }

    const attach = f => Object.assign({}, f, {
      opportunity: names[f.opportunity_id] || null,
    });

    // A flag stays 'pending' after a human decides it — the scheduled check is
    // what applies the fix and resolves it. Those two states used to share one
    // list, so a decided flag sat among the ones still needing attention.
    const awaitingHuman = pending.filter(f => !f.human_decision);
    const awaitingRun   = pending.filter(f => !!f.human_decision);

    const taskRuns = await fetchTaskRuns();

    return res.status(200).json({
      status: computeStatus(supabase, awaitingHuman.length, taskRuns),
      taskRuns,
      decided: awaitingRun.map(attach),
      supabase,
      pending:  awaitingHuman.map(attach),
      resolved: resolved.map(attach),
    });
  }

  // ── POST — record a human decision ──────────────────────────────────────────
  if (req.method === 'POST') {
    const { id, decision, note } = req.body || {};

    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (DECISIONS.indexOf(decision) === -1) {
      return res.status(400).json({ error: 'decision must be one of: ' + DECISIONS.join(', ') });
    }

    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    if (decision === 'change_needed' && !trimmedNote) {
      return res.status(400).json({ error: 'A note is required when marking a flag as needing a change.' });
    }

    // Deliberately does NOT touch status, resolved_at, resolution_type or
    // resolution_note: the row stays 'pending' and the scheduled Supabase check
    // applies the fix and resolves it on its next run.
    const patch = {
      human_decision: decision,
      human_note:     trimmedNote || null,
      decided_at:     new Date().toISOString(),
    };

    const r = await fetch(
      SUPABASE_URL + 'data_review_flags?id=eq.' + encodeURIComponent(id) + '&status=eq.pending',
      {
        method:  'PATCH',
        headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body:    JSON.stringify(patch),
      }
    );

    const body = await readJson(r);
    if (!r.ok) return res.status(500).json(failure('Could not save the decision.', r.status, body.text, body.parsed));

    // return=representation gives back the rows actually written; an empty array
    // means the filter matched nothing, which a bare 204 would have hidden.
    if (!Array.isArray(body.parsed) || body.parsed.length === 0) {
      return res.status(404).json({
        error: 'Nothing was saved — no pending flag matched id ' + id +
               '. It may already have been resolved by the automated check.',
      });
    }

    return res.status(200).json({ ok: true, flag: body.parsed[0] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
