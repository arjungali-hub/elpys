// The site's public address, for every absolute URL the server emits (sitemap,
// digest and alert emails, the geocoder's User-Agent). One place, so the next
// domain change is one edit here plus the hard-coded `seo:generated` blocks in
// the static HTML, which has no build step to share this with.
//
// www, https, no trailing slash: the bare domain 308s to www and the old
// *.vercel.app address 301s to it, so anything else would cost a redirect.
const SITE_URL = 'https://www.elpysvolunteering.com';

module.exports = { SITE_URL };
