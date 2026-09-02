// The password prompt behind the whole admin surface. checkAdminPassword
// compares in constant time and rate limits guesses per IP — see lib/adminAuth.js.
const { checkAdminPassword, adminSessionCookie } = require('../lib/adminAuth');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const denied = checkAdminPassword(req, password);
  if (denied) {
    // Keep this endpoint's own wording for a wrong password; the rate-limit and
    // misconfiguration messages come through as-is.
    const body = denied.status === 401 ? { error: 'Incorrect password' } : denied.body;
    return res.status(denied.status).json(body);
  }

  // Lets middleware.js serve admin.html/admin-review.html/review.html to this
  // browser instead of 404ing them — see adminSessionCookie's own comment.
  const cookie = adminSessionCookie();
  if (cookie) res.setHeader('Set-Cookie', cookie);

  return res.status(200).json({ ok: true });
};
