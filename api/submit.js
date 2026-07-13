// Vercel serverless function — /api/submit
//
// Required environment variables:
//   SUPABASE_URL              (same as admin function)
//   SUPABASE_SERVICE_ROLE_KEY (same as admin function — INSERT uses service role,
//                              so the anon INSERT policy can be dropped entirely)
//   TURNSTILE_SECRET_KEY      Cloudflare Turnstile secret key
//                             (get from dash.cloudflare.com → Turnstile)
//
// The anon key INSERT policy ("Anyone can submit a pending opportunity") should be
// dropped from Supabase after deploying this function:
//   DROP POLICY IF EXISTS "Anyone can submit a pending opportunity" ON "Opportunities";

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TURNSTILE_SECRET  = process.env.TURNSTILE_SECRET_KEY;

// ── In-memory rate limit store ────────────────────────────────────────────────
// Resets on each cold start / deploy. Per-instance, not global across Vercel
// function instances — good enough for low-volume spam deterrence at this scale.
const ipStore = new Map();
const RATE_MAX    = 10;
const RATE_WIN_MS = 60 * 60 * 1000; // 1 hour

function supabaseHeaders(extra) {
  return Object.assign({
    apikey:        SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  }, extra);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // ── 1. Honeypot ───────────────────────────────────────────────────────────
  // Real users never see or fill this field. If it has a value, silently
  // return success without inserting so bots don't know they were caught.
  if (body.website) {
    return res.status(200).json({ ok: true });
  }

  // ── 2. Turnstile CAPTCHA verification ─────────────────────────────────────
  // Skipped if TURNSTILE_SECRET_KEY is not configured (e.g. local dev).
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

  // ── 4. Server-side field validation ───────────────────────────────────────
  const REQUIRED = ['name','description','category','age_display','when','where','address','section','signup_link','signup_steps'];
  for (const f of REQUIRED) {
    const v = body[f];
    const empty = !v || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
    if (empty) return res.status(400).json({ error: 'Missing required field: ' + f });
  }
  if (!['online','contact'].includes(body.section)) {
    return res.status(400).json({ error: 'Invalid section value.' });
  }

  // ── 5. Duplicate name check (case-insensitive, all statuses) ─────────────
  const submittedName = String(body.name).trim();
  // Escape ilike wildcards so the name is treated as a literal string
  const escapedName = submittedName.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const dupRes = await fetch(
    SUPABASE_URL + 'Opportunities?name=ilike.' + encodeURIComponent(escapedName) + '&select=id,status&limit=1',
    { headers: supabaseHeaders() }
  );
  if (dupRes.ok) {
    const dups = await dupRes.json();
    if (Array.isArray(dups) && dups.length > 0) {
      const existing = dups[0];
      const label = existing.status === 'pending' ? 'already been submitted and is awaiting review' : 'already listed on the site';
      return res.status(409).json({ error: '"' + submittedName + '" has ' + label + '. If you think this is a mistake, please reach out directly.' });
    }
  }

  // ── 6. Build sanitized payload ────────────────────────────────────────────
  const steps = (Array.isArray(body.signup_steps) ? body.signup_steps : [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .slice(0, 20);

  const payload = {
    name:               String(body.name).trim().slice(0, 200),
    description:        String(body.description).trim().slice(0, 1000),
    long_description:   body.long_description ? String(body.long_description).trim().slice(0, 5000) : null,
    category:           String(body.category).trim().slice(0, 100),
    age_display:        String(body.age_display).trim().slice(0, 100),
    age_min:            body.age_min ? (parseInt(body.age_min, 10) || null) : null,
    when:               String(body.when).trim().slice(0, 200),
    where:              String(body.where).trim().slice(0, 200),
    address:            String(body.address).trim().slice(0, 300),
    signup_link:        String(body.signup_link).trim().slice(0, 500),
    signup_label:       body.signup_label ? String(body.signup_label).trim().slice(0, 50) : 'Sign up →',
    signup_steps:       steps,
    section:            body.section,
    website:            body.website_url   ? String(body.website_url).trim().slice(0, 300)   : null,
    contact_email:      body.contact_email ? String(body.contact_email).trim().slice(0, 200) : null,
    contact_phone:      body.contact_phone ? String(body.contact_phone).trim().slice(0, 50)  : null,
    card_note:          body.card_note   ? String(body.card_note).trim().slice(0, 500)  : null,
    admin_notes:        body.admin_notes ? String(body.admin_notes).trim().slice(0, 1000) : null,
    status:             'pending', // always set server-side, never from client
  };

  // ── 7. Insert via service role key ────────────────────────────────────────
  const r = await fetch(SUPABASE_URL + 'Opportunities', {
    method:  'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body:    JSON.stringify(payload),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('Supabase insert failed:', r.status, detail);
    return res.status(500).json({ error: 'Submission failed. Please try again.' });
  }

  return res.status(200).json({ ok: true });
};
