// Vercel serverless function — /api/checkpoint?return=/submit
//
// Where api-fetch.js sends the browser when Vercel's automatic bot check has
// challenged one of the page's fetch() calls. Visiting an /api/ URL as a
// normal page lets Vercel show its "Security Checkpoint" there, which a real
// browser can pass (a fetch() can't). Once through, this just redirects back
// to the page the person was on.
//
// Only same-site paths are accepted for `return`, so this can't be used to
// bounce visitors to another site.
function safeReturn(value) {
  const v = typeof value === 'string' ? value : '';
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\r\n\t]/.test(v) || v.length > 500) return '/';
  if (/^\/api(\/|$)/i.test(v)) return '/';
  return v;
}

module.exports = function handler(req, res) {
  const to = safeReturn(req.query && req.query.return);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', to);
  res.statusCode = 302;
  res.end();
};

module.exports.safeReturn = safeReturn;
