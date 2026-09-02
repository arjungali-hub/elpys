// Vercel Edge Middleware — runs ahead of static file serving, for every
// request whose path matches `config.matcher` below.
//
// admin.html, admin-review.html and review.html used to be publicly
// reachable: no admin data loads without the password (each has its own
// inline login form backed by lib/adminAuth.js's checkAdminPassword,
// unchanged by this file), but the page SHELL — and the fact that an admin
// system exists at these URLs at all — was visible to anyone. This makes an
// unauthenticated request 404 before any of that HTML ships.
//
// /admin-feedback, /admin-edit and /admin-approve are vercel.json rewrites
// onto admin.html?view=... — same page, same shell, so they need the same
// gate. Easy to miss (they were, once — a real regression caught during the
// clean-URLs work that added them, before it shipped: those three paths
// 200'd for a request with no session cookie at all, while /admin itself
// correctly 404'd). If a future rewrite adds another alias for a gated
// page, it needs to go in this matcher too, or it silently bypasses this
// whole file.
//
// They are flat (/admin-feedback), not nested (/admin/feedback), for a
// reason that is not cosmetic: admin.html references styles.css and
// loading.js RELATIVELY, so under a nested path the browser resolves them
// against /admin/ and requests /admin/styles.css — which does not exist,
// gets swallowed by the catch-all slug rewrite, and comes back as HTML.
// The page then loads with no CSS and a "Loading is not defined"
// ReferenceError. Verified on a preview deployment. Keep these flat.
//
// admin-login.html is deliberately NOT in the matcher. It has no admin data
// on it at all, and gating it would make it impossible for anyone —
// including the real admin — to ever obtain the session cookie this
// middleware checks for. It is the one door that has to stay open so the
// others can be closed: log in there first, then admin/admin-review/review
// all become reachable.
//
// The cookie is set by api/admin-login.js, api/admin.js and api/review.js on
// a successful password check — see adminSessionCookie() in
// lib/adminAuth.js, which signs it with HMAC-SHA256 using ADMIN_PASSWORD as
// the key. Verified here with the Web Crypto API rather than Node's crypto
// module, because the Edge runtime doesn't have the latter. The two
// implementations must be changed together if either ever is.
//
// A bug in this file can only make these three pages 404 or (if the check is
// ever loosened incorrectly) publicly loadable again — it does not touch
// checkAdminPassword or the data endpoints, so it cannot by itself expose
// admin data. Losing this file entirely is a visibility regression, not a
// security one.

const COOKIE_NAME = 'elpys_admin_session';

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeStringEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hasValidSession(request) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;

  const raw = getCookie(request, COOKIE_NAME);
  if (!raw) return false;

  const dot = raw.indexOf('.');
  if (dot === -1) return false;
  const exp = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Date.now() > Number(exp)) return false;

  const expected = await hmacHex(secret, exp);
  return constantTimeStringEqual(expected, sig);
}

export const config = {
  matcher: [
    '/admin', '/admin.html',
    '/admin-feedback', '/admin-edit', '/admin-approve',
    '/admin-review', '/admin-review.html',
    '/review', '/review.html',
    '/analytics-review', '/analytics-review.html',
  ],
};

export default async function middleware(request) {
  if (await hasValidSession(request)) return;

  // Same 404 page every other unmatched URL on the site gets — self-fetched
  // from this deployment rather than duplicated here, so it can't drift from
  // 404.html (which is itself generated from about.html's header/footer for
  // the same reason).
  const notFound = await fetch(new URL('/404.html', request.url));
  return new Response(await notFound.text(), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
