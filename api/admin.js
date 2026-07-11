// Vercel serverless function — /api/admin
//
// Required environment variables (set in Vercel project settings):
//   SUPABASE_URL              e.g. https://xxxx.supabase.co/rest/v1/
//   SUPABASE_SERVICE_ROLE_KEY  the service_role secret from Supabase → Settings → API
//   ADMIN_PASSWORD             any secret string you choose

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASS   = process.env.ADMIN_PASSWORD;

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

  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET — return pending + published ────────────────────────────────────────
  if (req.method === 'GET') {
    const [pendingRes, publishedRes, feedbackRes] = await Promise.all([
      fetch(SUPABASE_URL + 'Opportunities?status=eq.pending&select=*&order=created_at.asc',  { headers: supabaseHeaders() }),
      fetch(SUPABASE_URL + 'Opportunities?status=eq.published&select=*&order=name.asc', { headers: supabaseHeaders() }),
      fetch(SUPABASE_URL + 'Feedback?select=*&order=created_at.desc&limit=200', { headers: supabaseHeaders() }),
    ]);
    const pending   = await pendingRes.json();
    const published = await publishedRes.json();
    const feedback  = await feedbackRes.json();
    return res.status(200).json({ pending, published, feedback: Array.isArray(feedback) ? feedback : [] });
  }

  // ── POST — act on a row ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (action === 'approve') {
      const { lat, lng, slug } = req.body;
      if (!slug || lat == null || lng == null) {
        return res.status(400).json({ error: 'slug, lat, and lng are required to approve' });
      }

      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify({ status: 'published', slug: slug.trim(), lat: parseFloat(lat), lng: parseFloat(lng) }),
        }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    if (action === 'update') {
      const EDITABLE = ['name','description','long_description','category','age_display','age_min',
                        'when','where','address','lat','lng','signup_link','signup_steps','section',
                        'card_note','signup_label','slug','admin_notes',
                        'website','contact_email','contact_phone'];
      const updates = {};
      for (const key of EDITABLE) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify(updates),
        }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    if (action === 'unpublish') {
      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify({ status: 'pending' }),
        }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
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
