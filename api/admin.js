// Vercel serverless function — /api/admin
//
// Required environment variables (set in Vercel project settings):
//   SUPABASE_URL              e.g. https://xxxx.supabase.co/rest/v1/
//   SUPABASE_SERVICE_ROLE_KEY  the service_role secret from Supabase → Settings → API
//   ADMIN_PASSWORD             any secret string you choose

const { checkAdminPassword } = require('../lib/adminAuth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders(extra) {
  return Object.assign({
    apikey:        SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  }, extra);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const denied = checkAdminPassword(req, req.headers['x-admin-password']);
  if (denied) return res.status(denied.status).json(denied.body);

  // ── GET — return pending + published ────────────────────────────────────────
  if (req.method === 'GET') {
    const [pendingRes, publishedRes, feedbackRes] = await Promise.all([
      fetch(SUPABASE_URL + 'Opportunities?status=eq.pending&select=*&order=created_at.asc',  { headers: supabaseHeaders() }),
      fetch(SUPABASE_URL + 'Opportunities?status=eq.published&select=*&order=name.asc', { headers: supabaseHeaders() }),
      fetch(SUPABASE_URL + 'Feedback?select=*&order=created_at.desc&limit=200', { headers: supabaseHeaders() }),
    ]);
    // A failed query answers with a PostgREST error object, not an array. That
    // used to be handed straight to the panel, which then threw on .forEach and
    // rendered nothing, with no indication of why.
    async function rows(response, label) {
      const text = await response.text().catch(() => '');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }
      if (!response.ok || !Array.isArray(parsed)) {
        console.error('Admin GET failed for', label + ':', response.status, text.slice(0, 500));
        return { ok: false, status: response.status, message: (parsed && parsed.message) || null };
      }
      return { ok: true, rows: parsed };
    }

    const [pending, published, feedback] = await Promise.all([
      rows(pendingRes,   'pending'),
      rows(publishedRes, 'published'),
      rows(feedbackRes,  'feedback'),
    ]);

    // Feedback is a side panel — losing it should not blank the queue the
    // admin actually came for. The two opportunity lists are the page.
    if (!pending.ok || !published.ok) {
      const bad = !pending.ok ? pending : published;
      return res.status(502).json({
        error:   'Could not load opportunities from the database.',
        message: bad.message || ('Supabase answered HTTP ' + bad.status + '.'),
      });
    }

    return res.status(200).json({
      pending:   pending.rows,
      published: published.rows,
      feedback:  feedback.ok ? feedback.rows : [],
    });
  }

  // ── POST — act on a row ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // PATCH with return=minimal answers 204 even when the filter matched no
    // rows, so a write that changed nothing looked identical to a successful
    // one. Ask for the rows back and treat an empty result as a failure.
    async function patchRow(body) {
      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
          body: JSON.stringify(body),
        }
      );
      const text = await r.text().catch(() => '');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (_) { /* leave raw */ }

      if (!r.ok) {
        console.error('Admin PATCH failed:', r.status, text);
        return {
          ok: false, status: r.status,
          payload: {
            error:   'Save failed.',
            message: (parsed && parsed.message) || text.slice(0, 500) || null,
            details: (parsed && parsed.details) || null,
            hint:    (parsed && parsed.hint)    || null,
            code:    (parsed && parsed.code)    || null,
          },
        };
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.error('Admin PATCH matched no rows for id', id);
        return {
          ok: false, status: 404,
          payload: { error: 'Nothing was saved — no opportunity matched id ' + id + '.' },
        };
      }
      return { ok: true, row: parsed[0] };
    }

    if (action === 'approve') {
      const { lat, lng, slug } = req.body;
      if (!slug || lat == null || lng == null) {
        return res.status(400).json({ error: 'slug, lat, and lng are required to approve' });
      }

      const out = await patchRow({
        status: 'published',
        slug: slug.trim(),
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        published_at: new Date().toISOString(),
      });
      if (!out.ok) return res.status(out.status).json(out.payload);
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      const EDITABLE = ['name','description','long_description','category','age_display','age_min',
                        'when','schedule','where','address','lat','lng','signup_link','signup_steps','section',
                        'card_note','signup_label','slug','admin_notes',
                        'website','contact_email','contact_phone','opportunity_type','event_date'];
      const updates = {};
      for (const key of EDITABLE) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      const out = await patchRow(updates);
      if (!out.ok) return res.status(out.status).json(out.payload);
      return res.status(200).json({ ok: true, saved: Object.keys(updates) });
    }

    if (action === 'unpublish') {
      // Clearing published_at means a later re-approval stamps a fresh one
      // rather than keeping a stale date the digest would skip over.
      const out = await patchRow({ status: 'pending', published_at: null });
      if (!out.ok) return res.status(out.status).json(out.payload);
      return res.status(200).json({ ok: true });
    }

    if (action === 'reject' || action === 'delete') {
      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        { method: 'DELETE', headers: supabaseHeaders() }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    if (action === 'delete-feedback') {
      const r = await fetch(
        SUPABASE_URL + 'Feedback?id=eq.' + encodeURIComponent(id),
        { method: 'DELETE', headers: supabaseHeaders() }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
