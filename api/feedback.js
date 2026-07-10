// Vercel serverless function — /api/feedback
//
// Stores visitor feedback in the Supabase Feedback table.
// Create the table in Supabase with:
//
//   create table "Feedback" (
//     id           uuid primary key default gen_random_uuid(),
//     message      text not null,
//     page_url     text,
//     contact_email text,
//     created_at   timestamptz default now()
//   );
//
// RLS: no anon access needed — this function uses the service role key.
// Optionally enable RLS and grant no policies so only service role can insert/select.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  if (!body.message || !String(body.message).trim()) {
    return res.status(400).json({ error: 'Please describe what you found.' });
  }

  const payload = {
    message:       String(body.message).trim().slice(0, 2000),
    page_url:      body.page_url      ? String(body.page_url).trim().slice(0, 500)      : null,
    contact_email: body.contact_email ? String(body.contact_email).trim().slice(0, 200) : null,
  };

  const r = await fetch(SUPABASE_URL + 'Feedback', {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('Supabase feedback insert failed:', r.status, detail);
    return res.status(500).json({ error: 'Supabase error ' + r.status + ': ' + detail });
  }

  return res.status(200).json({ ok: true });
};
