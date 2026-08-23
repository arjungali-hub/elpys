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
// Turns a submitted address into coordinates so the admin gets a map pin to
// confirm rather than a blank pair of boxes to fill in by hand.
//
// Never throws and never blocks a submission: a vague address, a slow response
// or an outage all resolve to nulls, which the admin panel surfaces as "could
// not locate this" so the coordinates can be entered by hand. Nominatim's usage
// policy asks for an identifying User-Agent, so one is sent.
async function geocodeAddress(address) {
  const query = String(address || '').trim();
  if (!query) return { lat: null, lng: null, error: 'No address provided.' };

  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
            + encodeURIComponent(query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Elpys/1.0 (https://elpys.vercel.app; elpysnotifications@gmail.com)',
      },
      signal: controller.signal,
    });
    if (!r.ok) return { lat: null, lng: null, error: 'Geocoder returned HTTP ' + r.status + '.' };

    const matches = await r.json();
    if (!Array.isArray(matches) || !matches.length) {
      return { lat: null, lng: null, error: 'No match found for this address.' };
    }
    const lat = parseFloat(matches[0].lat);
    const lng = parseFloat(matches[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) {
      return { lat: null, lng: null, error: 'Geocoder returned unusable coordinates.' };
    }
    return { lat: lat, lng: lng, error: null };
  } catch (err) {
    const detail = err && err.name === 'AbortError' ? 'timed out after 8s' : (err && err.message) || String(err);
    console.error('Geocoding failed for', JSON.stringify(query), '-', detail);
    return { lat: null, lng: null, error: 'Could not reach the geocoder (' + detail + ').' };
  } finally {
    clearTimeout(timer);
  }
}

// Only http(s) and mailto links are accepted. Escaping stops an attribute
// breakout wherever this is rendered, but `javascript:` needs no quotes at all,
// and the admin panel shows this as a clickable link before approval.
function isSafeLink(url) {
  return /^(https?:\/\/|mailto:)/i.test(String(url || '').trim());
}

module.exports = async function handler(req, res) {
  try {
    return await handleSubmit(req, res);
  } catch (err) {
    console.error('/api/submit unhandled error:', err && err.stack ? err.stack : err);
    // The reason goes to the Vercel logs, not to the submitter — internal
    // error text tends to name tables, columns and configuration.
    return res.status(500).json({ error: 'Submission failed. Please try again.' });
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
    return res.status(500).json({ error: 'Submission failed. Please try again.' });
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
      return res.status(502).json({ error: 'Could not reach the CAPTCHA service. Please try again.' });
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

      // The diagnostic detail (error codes, hints, secret shape) stays in the
      // log line above. Sending it to the browser told anyone who asked how the
      // server's Turnstile secret is configured.
      console.error('Turnstile hints:',
        codes.map(c => TURNSTILE_CODE_HELP[c] || ('Unrecognized Cloudflare error code: ' + c)).join(' '));

      // An expired or already-used token is worth naming: retrying works, but
      // only after the widget issues a fresh one.
      const stale = codes.indexOf('timeout-or-duplicate') !== -1;
      return res.status(400).json({
        error: stale
          ? 'That CAPTCHA has expired. Please complete it again and resubmit.'
          : 'CAPTCHA verification failed. Please try again.',
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
  if (!isSafeLink(body.signup_link)) {
    return res.status(400).json({
      error: 'The sign-up link must start with http://, https:// or mailto:.',
    });
  }
  // Optional links get the same treatment — website is rendered as an <a> on
  // the detail page, live_url in the map sidebar.
  for (const field of ['website_url', 'live_url']) {
    const v = body[field];
    if (v && !isSafeLink(v) && !/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(String(v).trim())) {
      return res.status(400).json({ error: 'Please give a valid web address for ' + field.replace('_url', '') + '.' });
    }
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

  // ── 5b. Opportunity type + event date ─────────────────────────────────────
  const VALID_TYPES = ['recurring', 'one_time'];
  const opportunityType = VALID_TYPES.includes(body.opportunity_type) ? body.opportunity_type : 'recurring';

  let eventDate = null;
  if (opportunityType === 'one_time') {
    const raw = String(body.event_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(new Date(raw + 'T00:00:00Z').getTime())) {
      return res.status(400).json({ error: 'Please provide a valid event date.' });
    }
    // Plain string comparison (both YYYY-MM-DD) so the server's own timezone
    // can't shift what "today" means — reject a date that's already past.
    const todayIso = new Date().toISOString().slice(0, 10);
    if (raw < todayIso) {
      return res.status(400).json({ error: 'Event date must be today or in the future.' });
    }
    eventDate = raw;
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

  // Geocode before inserting so the pending row already carries coordinates.
  // Deliberately awaited rather than fired off afterwards: the admin needs the
  // pin on the very first look at the card, and a failure here is non-fatal.
  const submittedAddress = String(body.address).trim().slice(0, 300);
  const geocoded = await geocodeAddress(submittedAddress);
  if (geocoded.error) {
    console.warn('Submission stored without coordinates:', JSON.stringify(submittedAddress), '-', geocoded.error);
  }

  const payload = {
    name:               String(body.name).trim().slice(0, 200),
    description:        String(body.description).trim().slice(0, 1000),
    long_description:   body.long_description ? String(body.long_description).trim().slice(0, 5000) : null,
    category:           category.slice(0, 100),
    age_display:        String(body.age_display).trim().slice(0, 100),
    age_min:            body.age_min ? (parseInt(body.age_min, 10) || null) : null,
    when:               String(body.when).trim().slice(0, 200),
    opportunity_type:   opportunityType,
    event_date:         eventDate,
    // Defense in depth: force schedule null for one-time rows even if the
    // client somehow sent one (matches the DB's event_date/type CHECK intent).
    schedule:           opportunityType === 'one_time' ? null : schedule,
    where:              String(body.where).trim().slice(0, 200),
    address:            submittedAddress,
    // Best-effort coordinates for the admin's map preview; null when the
    // geocoder couldn't place the address, which the panel flags for manual
    // entry. Either way the admin confirms them before the listing publishes.
    lat:                geocoded.lat,
    lng:                geocoded.lng,
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
    const p = result.parsed;
    // PostgREST's complaint (message/details/hint/code) is logged in full —
    // it names tables, columns and constraints, so it does not go to the
    // submitter. Check the Vercel function logs when diagnosing a failure.
    console.error('Supabase insert failed:', result.status, JSON.stringify({
      message: (p && p.message) || String(result.detail || '').slice(0, 500) || null,
      details: (p && p.details) || null,
      hint:    (p && p.hint)    || null,
      code:    (p && p.code)    || null,
    }));

    return res.status(500).json({ error: 'Submission failed. Please try again.' });
  }

  return res.status(200).json({ ok: true });
}
