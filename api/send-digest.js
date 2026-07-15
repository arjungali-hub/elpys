// Weekly digest — sends matching new opportunities to each subscribed user.
// Triggered by Vercel cron (Authorization: Bearer $CRON_SECRET)
// or manually from the admin panel (x-admin-password header).

const sendEmail = require('../lib/sendEmail');

const SUPABASE_REST = process.env.SUPABASE_URL;          // https://xxx.supabase.co/rest/v1/
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET   = process.env.CRON_SECRET;
const ADMIN_PASS    = process.env.ADMIN_PASSWORD;

function supaHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Allow Vercel cron secret OR admin password for manual testing
  const authHeader = req.headers.authorization;
  const adminPw    = req.headers['x-admin-password'];
  const authorized =
    (CRON_SECRET && authHeader === 'Bearer ' + CRON_SECRET) ||
    (ADMIN_PASS  && adminPw   === ADMIN_PASS);
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

  const siteUrl = 'https://' + req.headers.host;

  // 1. New published opportunities in the last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oppRes = await fetch(
    SUPABASE_REST + 'Opportunities?status=eq.published&created_at=gte.' + since +
    '&select=id,name,description,slug,category',
    { headers: supaHeaders() }
  );
  if (!oppRes.ok) return res.status(500).json({ error: 'Failed to fetch opportunities' });
  const opportunities = await oppRes.json();

  if (!opportunities.length) {
    return res.status(200).json({ ok: true, message: 'No new opportunities this week — digest skipped.' });
  }

  // 2. Subscribed users with at least one interest and a stored email
  const profilesRes = await fetch(
    SUPABASE_REST + 'profiles?unsubscribed=eq.false&interests=not.eq.%7B%7D&email=not.is.null&select=id,interests,email',
    { headers: supaHeaders() }
  );
  if (!profilesRes.ok) return res.status(500).json({ error: 'Failed to fetch profiles' });
  const profiles = await profilesRes.json();

  if (!profiles.length) {
    return res.status(200).json({ ok: true, message: 'No subscribed users — digest skipped.' });
  }

  // 3. Send one digest per matching user
  let sent = 0, skipped = 0;

  for (const profile of profiles) {
    const to = profile.email;

    const interests = (Array.isArray(profile.interests) ? profile.interests : [])
      .map(i => i.toLowerCase());
    const matched   = opportunities.filter(opp => {
      if (!opp.category) return false;
      const cats = opp.category.split(/[,·]/).map(c => c.trim().toLowerCase()).filter(Boolean);
      return interests.some(i => cats.includes(i));
    });

    if (!matched.length) { skipped++; continue; }

    const unsubUrl = siteUrl + '/api/unsubscribe?id=' + profile.id;

    const itemsHtml = matched.map(opp => {
      const url = siteUrl + '/opportunities/detail.html?slug=' + encodeURIComponent(opp.slug || '');
      return (
        '<div style="border:1px solid #E5E7EB;border-radius:8px;padding:1rem 1.25rem;margin-bottom:0.75rem;">' +
          '<p style="font-size:1rem;font-weight:700;margin:0 0 0.3rem;color:#1A1A1A;">' + esc(opp.name) + '</p>' +
          '<p style="font-size:0.875rem;color:#555;line-height:1.5;margin:0 0 0.6rem;">' + esc(opp.description || '') + '</p>' +
          '<a href="' + url + '" style="font-size:0.875rem;font-weight:600;color:#1A1A1A;text-decoration:none;">View opportunity →</a>' +
        '</div>'
      );
    }).join('');

    const html =
      '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;' +
      'background:#F7F7F7;margin:0;padding:2rem 1rem;">' +
      '<div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;border:1px solid #E5E7EB;">' +
        '<p style="font-size:1.25rem;font-weight:700;letter-spacing:-0.02em;margin:0 0 0.25rem;color:#1A1A1A;">Elpys</p>' +
        '<p style="font-size:0.875rem;color:#888;margin:0 0 1.75rem;">New volunteer opportunities matching your interests</p>' +
        itemsHtml +
        '<p style="font-size:0.875rem;color:#444;margin-top:1.5rem;line-height:1.55;">' +
          'Browse all opportunities at <a href="' + siteUrl + '" style="color:#1A1A1A;">' + siteUrl.replace('https://', '') + '</a>.' +
        '</p>' +
        '<hr style="border:none;border-top:1px solid #E5E7EB;margin:1.5rem 0;">' +
        '<p style="font-size:0.75rem;color:#888;margin:0;">' +
          'You\'re receiving this because you have an Elpys account with saved interests. ' +
          '<a href="' + unsubUrl + '" style="color:#888;">Unsubscribe</a>' +
        '</p>' +
      '</div></body></html>';

    const text =
      'New volunteer opportunities on Elpys\n\n' +
      matched.map(opp => {
        const url = siteUrl + '/opportunities/detail.html?slug=' + encodeURIComponent(opp.slug || '');
        return opp.name + '\n' + (opp.description || '') + '\n' + url;
      }).join('\n\n') +
      '\n\n---\nUnsubscribe: ' + unsubUrl;

    try {
      await sendEmail({ to, subject: 'New volunteer opportunities this week — Elpys', html, text });
      sent++;
    } catch (err) {
      console.error('Failed to send to', to, err.message);
    }
  }

  return res.status(200).json({ ok: true, sent, skipped, totalProfiles: profiles.length });
};

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
