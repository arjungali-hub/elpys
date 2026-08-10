// Deletes the authenticated user's own account.
// Requires: Authorization: Bearer <user_jwt> in request header.
// Uses service role key to call Supabase Admin API after verifying the token.

const SUPABASE_AUTH_URL = 'https://ukrykzmehvghedrvmkjj.supabase.co/auth/v1';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No authorization header' });
  }
  const token = authHeader.slice(7);

  // Verify token and get the user's ID
  const userRes = await fetch(SUPABASE_AUTH_URL + '/user', {
    headers: {
      Authorization: 'Bearer ' + token,
      apikey:        SUPABASE_KEY,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid or expired session' });

  const user = await userRes.json();
  if (!user || !user.id) return res.status(401).json({ error: 'Could not identify user' });

  // Delete the user via Admin API
  const deleteRes = await fetch(SUPABASE_AUTH_URL + '/admin/users/' + user.id, {
    method:  'DELETE',
    headers: {
      Authorization: 'Bearer ' + SUPABASE_KEY,
      apikey:        SUPABASE_KEY,
    },
  });

  if (!deleteRes.ok) {
    const body = await deleteRes.json().catch(() => ({}));
    return res.status(deleteRes.status).json({ error: body.message || 'Failed to delete account' });
  }

  return res.status(200).json({ ok: true });
};
