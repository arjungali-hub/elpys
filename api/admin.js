// Vercel serverless function — /api/admin
//
// Required environment variables (set in Vercel project settings):
//   SUPABASE_URL              e.g. https://xxxx.supabase.co/rest/v1/
//   SUPABASE_SERVICE_ROLE_KEY  the service_role secret from Supabase → Settings → API
//   ADMIN_PASSWORD             any secret string you choose
//
// The service role key bypasses RLS so this function can read and update
// pending rows that the public anon key cannot see. It never leaves this file.

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
  // ── CORS headers so admin.html (same Vercel domain) can call this ──────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── Password check ──────────────────────────────────────────────────────────
  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET — list all pending submissions ──────────────────────────────────────
  if (req.method === 'GET') {
    const r = await fetch(
      SUPABASE_URL + 'Opportunities?status=eq.pending&select=*&order=created_at.asc',
      { headers: supabaseHeaders() }
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  }

  // ── POST — approve or reject a specific submission ──────────────────────────
  if (req.method === 'POST') {
    const { action, id, lat, lng, slug } = req.body || {};

    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (action === 'approve') {
      if (!slug || lat == null || lng == null) {
        return res.status(400).json({ error: 'slug, lat, and lng are required to approve' });
      }
      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: supabaseHeaders({
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          }),
          body: JSON.stringify({
            status: 'published',
            slug:   slug.trim(),
            lat:    parseFloat(lat),
            lng:    parseFloat(lng),
          }),
        }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    if (action === 'reject') {
      const r = await fetch(
        SUPABASE_URL + 'Opportunities?id=eq.' + encodeURIComponent(id),
        {
          method: 'DELETE',
          headers: supabaseHeaders(),
        }
      );
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    return res.status(400).json({ error: 'Unknown action. Use "approve" or "reject".' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
