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

// Supabase pauses a free project after this long without activity.
const PAUSE_AFTER_DAYS = 7;
// How little margin is left before the header dot turns red. At 5 days idle
// there are 2 days to act, which is what "about to pause" is worth warning
// about — raise or lower this one number to change how early the warning fires.
const PAUSE_WARN_AT_IDLE_DAYS = 5;

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

// Newest write we can see across the app's own tables.
//
// This is a PROXY for Supabase's pause clock, not the clock itself: Supabase
// counts any API request as activity, including plain page views, which leave
// no trace in the data. So this can only say "nothing has been written here
// for a while" — a good signal that the project is idle, but it will read
// stale on a site that is being read and not written to. Erring toward warning
// early is the right side to be wrong on; the cost of a false warning is a
// glance at the dashboard, the cost of a missed one is a paused site.
async function newestActivity() {
  const probes = [
    'Opportunities?select=created_at&order=created_at.desc.nullslast&limit=1',
    'Opportunities?select=published_at&order=published_at.desc.nullslast&limit=1',
    'Feedback?select=created_at&order=created_at.desc.nullslast&limit=1',
    'data_review_flags?select=last_flagged_at&order=last_flagged_at.desc.nullslast&limit=1',
  ];

  let newest = null;
  await Promise.all(probes.map(async (path) => {
    try {
      const r = await fetch(SUPABASE_URL + path, { headers: supabaseHeaders() });
      if (!r.ok) return;
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return;
      const value = Object.values(rows[0])[0];
      if (!value) return;
      const t = new Date(value).getTime();
      if (isFinite(t) && (newest === null || t > newest)) newest = t;
    } catch (_) { /* one missing table must not sink the whole probe */ }
  }));

  if (newest === null) return { lastActivityAt: null, idleDays: null };
  return {
    lastActivityAt: new Date(newest).toISOString(),
    idleDays: Math.floor((Date.now() - newest) / 86400000),
  };
}

// The single traffic light the admin header shows. Most urgent wins:
//   red    — the project looks about to pause; act now or the site goes down
//   yellow — flags are waiting on a human, or the project is already paused
//   green  — nothing waiting and nothing to worry about
function computeStatus(supabase, awaitingHuman, activity) {
  if (supabase.state === 'active' && activity.idleDays !== null &&
      activity.idleDays >= PAUSE_WARN_AT_IDLE_DAYS) {
    return {
      dot: 'red',
      label: 'Supabase may pause soon',
      detail: 'No database writes for ' + activity.idleDays + ' days. Free projects pause after ' +
              PAUSE_AFTER_DAYS + ' days idle. Note this only counts writes — page views keep the ' +
              'project awake without showing up here.',
    };
  }
  if (supabase.state !== 'active') {
    return {
      dot: 'yellow',
      label: supabase.state === 'paused' ? 'Supabase is paused' : 'Supabase is unreachable',
      detail: supabase.detail || 'The review queue cannot load until the project is running again.',
    };
  }
  if (awaitingHuman > 0) {
    return {
      dot: 'yellow',
      label: awaitingHuman + (awaitingHuman === 1 ? ' flag needs review' : ' flags need review'),
      detail: 'The weekly accuracy check raised these and is waiting on your decision.',
    };
  }
  return { dot: 'green', label: 'All clear', detail: 'Nothing waiting on you, and the database is healthy.' };
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
      const status = computeStatus(supabase, 0, { lastActivityAt: null, idleDays: null });
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

      const [awaitingHuman, awaitingRun, activity] = await Promise.all([
        countOf('status=eq.pending&human_decision=is.null'),
        countOf('status=eq.pending&human_decision=not.is.null'),
        newestActivity(),
      ]);

      return res.status(200).json({
        supabase,
        awaitingHuman,
        awaitingRun,
        activity,
        status: computeStatus(supabase, awaitingHuman, activity),
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

    const activity = await newestActivity();

    return res.status(200).json({
      status: computeStatus(supabase, awaitingHuman.length, activity),
      activity,
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
