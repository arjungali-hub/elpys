// Shared admin credential check for /api/admin, /api/review, /api/admin-login
// and /api/send-digest.
//
// The whole admin surface is gated by one shared password sent in a header, so
// this is the only thing standing between a guesser and write access to the
// database. Two properties matter:
//
//   1. Comparison is constant-time. A === on strings returns as soon as it
//      hits a differing byte, which leaks the length of the matching prefix.
//   2. Guesses are rate limited. /api/submit and /api/feedback both limit by
//      IP; the endpoint guarding the database did not, so an attacker could
//      try passwords as fast as the network allowed.
//
// Like the other limiters here, the store is per-instance and resets on cold
// start. That is not a real lockout, but it turns an unbounded online guessing
// attack into a slow one, which is the point at this scale.

const crypto = require('crypto');

const ADMIN_PASS = process.env.ADMIN_PASSWORD;

const attempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS    = 15 * 60 * 1000;

// Entries were never removed once their window expired, so this Map grew by one
// entry per unique IP for the whole life of a warm instance — unbounded, on a
// 128MB function. It also made the privacy policy's "held in server memory for
// at most one hour" untrue: the window expired, the record did not. Sweeping on
// each request fixes both. O(n) per request is irrelevant at a size this stays
// small precisely because of the sweep.
function pruneExpired(store, windowMs, now) {
  for (const [key, rec] of store) {
    if (now - rec.windowStart >= windowMs) store.delete(key);
  }
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

// timingSafeEqual throws on length mismatch, which would itself leak the
// length. Hashing both sides first gives two equal-length buffers.
function constantTimeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Returns null when the caller is authorized, or { status, body } to send back.
// Successful requests clear the counter so ordinary admin use never trips it.
function checkAdminPassword(req, provided) {
  if (!ADMIN_PASS) {
    console.error('ADMIN_PASSWORD is not set — refusing all admin requests.');
    return { status: 500, body: { error: 'Server is missing admin configuration.' } };
  }

  const ip  = clientIp(req);
  const now = Date.now();
  pruneExpired(attempts, WINDOW_MS, now);
  const rec = attempts.get(ip);
  const active = rec && now - rec.windowStart < WINDOW_MS;

  if (active && rec.count >= MAX_ATTEMPTS) {
    return {
      status: 429,
      body: { error: 'Too many incorrect attempts. Please wait 15 minutes and try again.' },
    };
  }

  if (!provided || !constantTimeEqual(provided, ADMIN_PASS)) {
    if (active) rec.count++;
    else attempts.set(ip, { count: 1, windowStart: now });
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  attempts.delete(ip);
  return null;
}

// ── Edge session cookie ─────────────────────────────────────────────────────
//
// Separate from checkAdminPassword above and does not change its contract —
// api/send-digest.js also calls checkAdminPassword and must keep working
// unmodified. This is for one new thing: middleware.js, running on the Edge
// ahead of admin.html/admin-review.html/review.html, needs a way to tell
// "has this browser already authenticated" from a plain page GET, which
// carries no x-admin-password header. A signed cookie set on successful
// login is that signal. It gates whether the page SHELL is served at all —
// the real data underneath is still, unchanged, gated per-request by
// checkAdminPassword via x-admin-password. Losing this cookie logic entirely
// would only make admin/admin-review/review publicly loadable again; it
// cannot by itself expose data, so a bug here is a visibility regression, not
// a data-security one.
//
// HMAC-SHA256 over the expiry timestamp, keyed on ADMIN_PASSWORD so no new
// secret is needed. The password itself is never placed in the cookie.
// Verified independently in middleware.js using Web Crypto (the Edge runtime
// has no access to Node's crypto module) — same algorithm, different API,
// so the two must be changed together if either ever is.
const SESSION_COOKIE  = 'elpys_admin_session';
const SESSION_MAX_AGE_S = 12 * 60 * 60; // 12 hours

function adminSessionCookie(now) {
  if (!ADMIN_PASS) return null;
  const exp = (now || Date.now()) + SESSION_MAX_AGE_S * 1000;
  const sig = crypto.createHmac('sha256', ADMIN_PASS).update(String(exp)).digest('hex');
  const value = exp + '.' + sig;
  return SESSION_COOKIE + '=' + value + '; Path=/; Max-Age=' + SESSION_MAX_AGE_S +
    '; HttpOnly; Secure; SameSite=Lax';
}

module.exports = { checkAdminPassword, adminSessionCookie, SESSION_COOKIE };
