// Serves /sitemap.xml (see the rewrite in vercel.json).
//
// Generated rather than checked in because the interesting half of the sitemap
// is the listing detail pages, and those change every time a submission is
// approved or a one-time event's date passes. A static file would be wrong
// within a week and nobody would notice.
//
// The listing query deliberately mirrors the public client's own filter in
// supabase-client.js: published rows, plus one-time rows only while their date
// is still in the future. A sitemap should never advertise a URL the site
// itself has stopped showing.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE = 'https://elpys.vercel.app';

// Everything that exists whether or not the database answers. `changefreq` and
// `priority` are hints only — Google ignores both — but they cost nothing and
// other crawlers still read them.
const STATIC_PAGES = [
  { loc: '/',              changefreq: 'daily',   priority: '1.0' },
  { loc: '/map',           changefreq: 'daily',   priority: '0.9' },
  { loc: '/about',         changefreq: 'monthly', priority: '0.7' },
  { loc: '/how-we-check',  changefreq: 'monthly', priority: '0.7' },
  { loc: '/submit',        changefreq: 'monthly', priority: '0.6' },
  { loc: '/feedback',      changefreq: 'yearly',  priority: '0.3' },
  { loc: '/privacy',       changefreq: 'yearly',  priority: '0.3' },
  { loc: '/terms',         changefreq: 'yearly',  priority: '0.3' },
];

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[ch]));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchSlugs() {
  // A missing env var must not take the sitemap down — the static half is still
  // worth serving. Same for any Supabase failure below.
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const base = SUPABASE_URL.endsWith('/') ? SUPABASE_URL : SUPABASE_URL + '/';
  const url = base + 'Opportunities'
    + '?status=eq.published'
    + '&select=slug,published_at'
    + '&or=(opportunity_type.eq.recurring,event_date.gte.' + todayIso() + ')'
    + '&order=slug.asc';

  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  if (!r.ok) {
    console.error('sitemap: Supabase returned', r.status, await r.text().catch(() => ''));
    return [];
  }
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows.filter(row => row && row.slug) : [];
}

module.exports = async function handler(req, res) {
  let listings = [];
  try {
    listings = await fetchSlugs();
  } catch (err) {
    console.error('sitemap: listing fetch threw', err);
  }

  const today = todayIso();
  const urls = [
    ...STATIC_PAGES.map(p =>
      '  <url>\n' +
      '    <loc>' + SITE + p.loc + '</loc>\n' +
      '    <lastmod>' + today + '</lastmod>\n' +
      '    <changefreq>' + p.changefreq + '</changefreq>\n' +
      '    <priority>' + p.priority + '</priority>\n' +
      '  </url>'
    ),
    ...listings.map(row =>
      '  <url>\n' +
      '    <loc>' + SITE + '/opportunities-detail?slug=' + xmlEscape(encodeURIComponent(row.slug)) + '</loc>\n' +
      '    <lastmod>' + (row.published_at ? String(row.published_at).slice(0, 10) : today) + '</lastmod>\n' +
      '    <changefreq>weekly</changefreq>\n' +
      '    <priority>0.8</priority>\n' +
      '  </url>'
    ),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n' +
    '</urlset>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // An hour of CDN caching: crawlers re-fetch far more often than listings
  // change, and a stale-by-an-hour sitemap costs nothing.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  return res.status(200).send(xml);
};
