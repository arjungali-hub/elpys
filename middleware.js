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

// Old-URL redirects handled HERE rather than in vercel.json's redirects[],
// because Vercel re-appends the incoming query string to any redirect
// destination that doesn't already carry one. That turned
// /opportunities-detail?slug=wta into /wta?slug=wta — right page, but a
// leftover parameter hanging off a URL whose whole point was to be clean.
// `preserveQueryParams` is a Bulk Redirects API field, not a vercel.json key
// (confirmed by a failed deployment), so there is no way to switch that off
// in the config file. Middleware builds the Location header itself, so it can
// simply not include the query.
//
// SAFETY: these are matched on the ORIGINAL request path. /opportunities-detail
// is also the internal destination of the catch-all slug rewrite, so if
// middleware ran on rewritten paths this would redirect /earthcorps to itself
// forever. Verified on a preview deployment that it does not — but if this
// file's matcher is ever changed, re-test /earthcorps for a redirect loop
// before shipping.
const ADMIN_VIEW_REDIRECTS = {
  feedback: '/admin-feedback',
  edit:     '/admin-edit',
  confirm:  '/admin-approve',
};

export const config = {
  matcher: [
    '/admin', '/admin.html',
    '/admin-feedback', '/admin-edit', '/admin-approve',
    '/admin-review', '/admin-review.html',
    '/review', '/review.html',
    '/analytics-review', '/analytics-review.html',
    // Public — present only for the query-stripping redirect below, never gated.
    '/opportunities-detail', '/opportunities-detail.html',
    '/opportunities/detail', '/opportunities/detail.html',
  ],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

  // ── Public: old listing URLs → clean /<slug>, query dropped ───────────────
  // Deliberately before the auth gate: these are public pages and must never
  // be gated.
  if (path === '/opportunities-detail' || path === '/opportunities/detail') {
    const slug = url.searchParams.get('slug');
    if (slug) {
      return Response.redirect(new URL('/' + encodeURIComponent(slug), url.origin), 308);
    }
    // No slug. The legacy /opportunities/detail path has no page of its own,
    // so send it to the real one; bare /opportunities-detail IS a real page
    // (its own "no opportunity specified" state), so let it through.
    if (path === '/opportunities/detail') {
      return Response.redirect(new URL('/opportunities-detail', url.origin), 308);
    }
    return;
  }

  // ── Admin surface: gate first ─────────────────────────────────────────────
  if (!(await hasValidSession(request))) {
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

  // ── Signed in: old /admin?view=X → clean /admin-X, query dropped ──────────
  // After the gate on purpose. Redirecting first would confirm to a signed-out
  // stranger that /admin-feedback exists; this way they just get the 404.
  if (path === '/admin') {
    const view = url.searchParams.get('view');
    const target = view && Object.prototype.hasOwnProperty.call(ADMIN_VIEW_REDIRECTS, view)
      ? ADMIN_VIEW_REDIRECTS[view]
      : null;
    if (target) return Response.redirect(new URL(target, url.origin), 308);
  }
}
