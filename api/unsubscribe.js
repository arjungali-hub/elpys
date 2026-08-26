const SUPABASE_REST = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  const { id } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // Profile ids are UUIDs. Checking the shape here keeps malformed input from
  // reaching PostgREST as a query it will only reject anyway.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID.test(String(id))) {
    return res.status(400).send(page('Invalid link', 'This unsubscribe link is not valid.'));
  }

  const r = await fetch(
    SUPABASE_REST + 'profiles?id=eq.' + encodeURIComponent(id),
    {
      method:  'PATCH',
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        // return=minimal answers 204 whether or not the id matched anything,
        // so an unknown id used to show the success page.
        Prefer:        'return=representation',
      },
      body: JSON.stringify({ unsubscribed: true }),
    }
  );

  if (!r.ok) {
    console.error('Unsubscribe PATCH failed:', r.status, await r.text().catch(() => ''));
    return res.status(500).send(page('Something went wrong', 'Could not process your request. Please try again.'));
  }

  const updated = await r.json().catch(() => null);
  if (!Array.isArray(updated) || updated.length === 0) {
    return res.status(404).send(page(
      'We couldn\'t find that account',
      'This unsubscribe link doesn\'t match an Elpys account. It may have been deleted already. ' +
      'If you\'re still receiving emails, <a href="/feedback">let us know</a>.'
    ));
  }

  return res.status(200).send(page(
    'You\'ve been unsubscribed',
    'You won\'t receive any more weekly digest emails from Elpys. ' +
    'You can re-enable notifications anytime from your <a href="/account">account page</a>.'
  ));
};

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Elpys</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #F7F7F7; margin: 0; padding: 3rem 1rem; color: #1A1A1A; }
    .box { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 2rem 2rem 2.5rem; border: 1px solid #E5E7EB; }
    h1 { font-size: 1.375rem; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.75rem; }
    p { font-size: 0.9375rem; color: #444; line-height: 1.6; margin: 0 0 0.75rem; }
    a { color: #1A1A1A; }
    .back { display: inline-block; margin-top: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${title}</h1>
    <p>${body}</p>
    <a href="/" class="back">← Back to Elpys</a>
  </div>
</body>
</html>`;
}
