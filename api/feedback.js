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

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

// ── In-memory rate limit store ────────────────────────────────────────────────
const ipStore    = new Map();
const RATE_MAX    = 5;
const RATE_WIN_MS = 60 * 60 * 1000; // 1 hour

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // ── 1. Honeypot ───────────────────────────────────────────────────────────
  if (body.website) {
    return res.status(200).json({ ok: true });
  }

  // ── 2. Turnstile CAPTCHA verification ─────────────────────────────────────
  if (TURNSTILE_SECRET) {
    const token = body['cf-turnstile-response'];
    if (!token) {
      return res.status(400).json({ error: 'Please complete the CAPTCHA.' });
    }
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token }),
    });
    const ts = await tsRes.json();
    if (!ts.success) {
      return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
    }
  }

  // ── 3. Rate limiting by IP ────────────────────────────────────────────────
  const ip  = (String(req.headers['x-forwarded-for'] || '')).split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const rec = ipStore.get(ip);
  if (rec && now - rec.windowStart < RATE_WIN_MS) {
    if (rec.count >= RATE_MAX) {
      return res.status(429).json({ error: 'Too many submissions from your connection. Please try again in an hour.' });
    }
    rec.count++;
  } else {
    ipStore.set(ip, { count: 1, windowStart: now });
  }

  // ── 4. Validate required field ────────────────────────────────────────────
  if (!body.message || !String(body.message).trim()) {
    return res.status(400).json({ error: 'Please describe what you found.' });
  }

  // ── 5. Insert via service role key ────────────────────────────────────────
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
