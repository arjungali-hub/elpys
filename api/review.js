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

const SUPABASE_URL = restBase(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASS   = process.env.ADMIN_PASSWORD;

const RESOLVED_LIMIT = 20;
const DECISIONS = ['change_needed', 'fine_as_is'];

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

  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('/api/review misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({
      error:   'Data review request failed.',
      message: 'Server is missing Supabase configuration (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

  // ── GET — pending queue + recently resolved ─────────────────────────────────
  if (req.method === 'GET') {
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

    return res.status(200).json({
      pending:  pending.map(attach),
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
