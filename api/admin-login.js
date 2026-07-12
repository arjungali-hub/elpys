const ADMIN_PASS = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  return res.status(200).json({ ok: true });
};
