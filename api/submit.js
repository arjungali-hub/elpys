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

// Accepts SUPABASE_URL either as the bare project URL or with /rest/v1/ already
// on it — the rest of this file appends table names directly, so a missing
// suffix silently turns every query into a 404.
function restBase(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u.endsWith('/')) u += '/';
  if (!/\/rest\/v1\/$/.test(u)) u += 'rest/v1/';
  return u;
}

const SUPABASE_URL      = restBase(process.env.SUPABASE_URL);
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Trimmed: a trailing newline or stray space pasted into the Vercel dashboard
// is invisible there but makes Cloudflare answer "invalid-input-secret".
const TURNSTILE_SECRET  = (process.env.TURNSTILE_SECRET_KEY || '').trim();

// Cloudflare's siteverify error codes, translated into what to actually do.
const TURNSTILE_CODE_HELP = {
  'missing-input-secret':   'TURNSTILE_SECRET_KEY is not set on the server.',
  'invalid-input-secret':   'TURNSTILE_SECRET_KEY is not a valid Turnstile secret key (wrong value, or a site key was pasted instead of the secret key).',
  'missing-input-response': 'No CAPTCHA token was sent with the submission.',
  'invalid-input-response': 'The CAPTCHA token is malformed, or it was issued by a different site key than the secret key belongs to.',
  'timeout-or-duplicate':   'The CAPTCHA token was already used or has expired. Tokens are single-use and valid for about 5 minutes, so a retry must use a freshly issued token.',
  'bad-request':            'Cloudflare rejected the verification request as malformed.',
  'invalid-widget-id':      'The widget id in the token does not exist for this secret key.',
  'invalid-parsed-secret':  'The secret key could not be parsed.',
  'internal-error':         'Cloudflare had an internal error verifying the token. Retrying usually works.',
};

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

// Anything thrown below (bad env, network failure, malformed JSON) would
// otherwise surface as a bodyless 500 with no way to tell what broke.
module.exports = async function handler(req, res) {
  try {
    return await handleSubmit(req, res);
  } catch (err) {
    console.error('/api/submit unhandled error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      error:   'Submission failed.',
      message: err && err.message ? err.message : String(err),
    });
  }
};

async function handleSubmit(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('/api/submit misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({
      error:   'Submission failed.',
      message: 'Server is missing Supabase configuration (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

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
      return res.status(400).json({
        error:  'Please complete the CAPTCHA.',
        reason: 'no-token-in-request',
      });
    }

    let tsRes, tsRaw = '', ts = null;
    try {
      tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // remoteip is deliberately omitted: behind a proxy it can disagree with
        // the IP Cloudflare saw when issuing the token and fail verification.
        body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token }),
      });
      tsRaw = await tsRes.text();
      try { ts = JSON.parse(tsRaw); } catch (_) { /* non-JSON — kept in tsRaw */ }
    } catch (err) {
      console.error('Turnstile siteverify request failed:', err && err.stack ? err.stack : err);
      return res.status(502).json({
        error:   'Could not reach the CAPTCHA service. Please try again.',
        message: err && err.message ? err.message : String(err),
      });
    }

    if (!ts || ts.success !== true) {
      const codes = (ts && Array.isArray(ts['error-codes'])) ? ts['error-codes'] : [];
      // Log the full picture server-side, including secret *shape* (never the
      // value) so a wrong/blank env var is distinguishable from a bad token.
      console.error('Turnstile verification failed:', JSON.stringify({
        httpStatus:   tsRes ? tsRes.status : null,
        errorCodes:   codes,
        raw:          tsRaw.slice(0, 300),
        tokenLength:  String(token).length,
        secretLength: TURNSTILE_SECRET.length,
        secretPrefix: TURNSTILE_SECRET.slice(0, 3),
      }));

      return res.status(400).json({
        error:            'CAPTCHA verification failed. Please try again.',
        turnstileCodes:   codes,
        turnstileHints:   codes.map(c => TURNSTILE_CODE_HELP[c] || ('Unrecognized Cloudflare error code: ' + c)),
        turnstileStatus:  tsRes ? tsRes.status : null,
        turnstileRaw:     codes.length ? undefined : tsRaw.slice(0, 300),
        secretConfigured: true,
        secretLength:     TURNSTILE_SECRET.length,
      });
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
  if (!dupRes.ok) {
    // Not fatal — the insert below is the real gate — but a failure here almost
    // always means the URL or key is wrong, which would otherwise stay silent.
    console.error('Duplicate check failed:', dupRes.status, await dupRes.text().catch(() => ''));
  } else {
    const dups = await dupRes.json();
    if (Array.isArray(dups) && dups.length > 0) {
      const existing = dups[0];
      const label = existing.status === 'pending' ? 'already been submitted and is awaiting review' : 'already listed on the site';
      return res.status(409).json({ error: '"' + submittedName + '" has ' + label + '. If you think this is a mistake, please reach out directly.' });
    }
  }

  // ── 6. Build sanitized payload ────────────────────────────────────────────
  // signup_steps is a TEXT column storing " | "-separated steps, e.g.
  //   "Register online | Complete the waiver | Show up"
  // Accept an array too, since a cached copy of the old form still posts one —
  // that mismatch is what stored ["a"] as a literal string on an earlier row.
  // Pipes inside a step would corrupt the delimiter, so they become slashes.
  const rawSteps = Array.isArray(body.signup_steps)
    ? body.signup_steps
    : String(body.signup_steps == null ? '' : body.signup_steps).split(/[\n|]/);
  const steps = rawSteps
    .map(s => String(s).replace(/\|/g, '/').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!steps.length) {
    return res.status(400).json({ error: 'Missing required field: signup_steps' });
  }
  const signupSteps = steps.join(' | ');

  // category is a TEXT column storing lowercase, comma-separated values, e.g.
  // "community, food". Accept "·" as a separator as well, which is how the
  // published rows are rendered and how the old form joined them.
  const category = String(body.category == null ? '' : body.category)
    .split(/\s*[·,]\s*/)
    .map(c => c.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(', ');
  if (!category) {
    return res.status(400).json({ error: 'Missing required field: category' });
  }

  const SCHEDULE_DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const SCHEDULE_SLOTS = ['morning','afternoon','evening'];
  let schedule = null;
  if (body.schedule && typeof body.schedule === 'object' && !Array.isArray(body.schedule)) {
    const clean = {};
    let hasEntry = false;
    for (const day of SCHEDULE_DAYS) {
      const slots = Array.isArray(body.schedule[day])
        ? body.schedule[day].filter(s => SCHEDULE_SLOTS.includes(s))
        : [];
      clean[day] = slots;
      if (slots.length) hasEntry = true;
    }
    if (hasEntry) schedule = clean;
  }

  const payload = {
    name:               String(body.name).trim().slice(0, 200),
    description:        String(body.description).trim().slice(0, 1000),
    long_description:   body.long_description ? String(body.long_description).trim().slice(0, 5000) : null,
    category:           category.slice(0, 100),
    age_display:        String(body.age_display).trim().slice(0, 100),
    age_min:            body.age_min ? (parseInt(body.age_min, 10) || null) : null,
    when:               String(body.when).trim().slice(0, 200),
    schedule:           schedule,
    where:              String(body.where).trim().slice(0, 200),
    address:            String(body.address).trim().slice(0, 300),
    signup_link:        String(body.signup_link).trim().slice(0, 500),
    signup_label:       body.signup_label ? String(body.signup_label).trim().slice(0, 50) : 'Sign up →',
    signup_steps:       signupSteps,
    section:            body.section,
    website:            body.website_url   ? String(body.website_url).trim().slice(0, 300)   : null,
    contact_email:      body.contact_email ? String(body.contact_email).trim().slice(0, 200) : null,
    contact_phone:      body.contact_phone ? String(body.contact_phone).trim().slice(0, 50)  : null,
    card_note:          body.card_note   ? String(body.card_note).trim().slice(0, 500)  : null,
    admin_notes:        body.admin_notes ? String(body.admin_notes).trim().slice(0, 1000) : null,
    status:             'pending', // always set server-side, never from client
  };

  // ── 7. Insert via service role key ────────────────────────────────────────
  async function insertRow(row) {
    const r = await fetch(SUPABASE_URL + 'Opportunities', {
      method:  'POST',
      headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body:    JSON.stringify(row),
    });
    if (r.ok) return { ok: true };
    const detail = await r.text().catch(() => '');
    let parsed = null;
    try { parsed = JSON.parse(detail); } catch (_) { /* not JSON — fall back to raw text */ }
    return { ok: false, status: r.status, detail, parsed };
  }

  let result = await insertRow(payload);

  // The submit form's weekly schedule picker posts a `schedule` object, but the
  // Opportunities table has no such column — PostgREST rejects the whole insert
  // (PGRST204) even when the value is null, which failed every submission.
  // Drop it and retry rather than lose the submission; once the column exists
  // the first insert succeeds and this path stops running. To keep the
  // structured schedule (used for availability matching in the weekly digest):
  //   alter table "Opportunities" add column schedule jsonb;
  if (!result.ok && result.parsed && result.parsed.code === 'PGRST204' &&
      /schedule/.test(String(result.parsed.message || ''))) {
    console.warn('Opportunities.schedule column missing — retrying without it. ' +
                 'Add it with: alter table "Opportunities" add column schedule jsonb;');
    const retry = Object.assign({}, payload);
    delete retry.schedule;
    result = await insertRow(retry);
    if (result.ok) return res.status(200).json({ ok: true, warning: 'schedule-column-missing' });
  }

  if (!result.ok) {
    console.error('Supabase insert failed:', result.status, result.detail);
    const p = result.parsed;

    // Surface PostgREST's actual complaint (message/details/hint/code) instead
    // of a bare 500, so a column-type or constraint mismatch is diagnosable
    // from the response rather than only from the Vercel logs.
    return res.status(500).json({
      error:          'Submission failed. Please try again.',
      supabaseStatus: result.status,
      message:        (p && p.message) || String(result.detail || '').slice(0, 500) || null,
      details:        (p && p.details) || null,
      hint:           (p && p.hint)    || null,
      code:           (p && p.code)    || null,
    });
  }

  return res.status(200).json({ ok: true });
}
