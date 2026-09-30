// Delete unused photos — removes files in the opportunity-images bucket that no
// listing uses any more.
// Triggered weekly by Vercel cron (Authorization: Bearer $CRON_SECRET), or from
// the admin "Delete unused photos" button (x-admin-password header).
//
// Nothing else ever deletes a Storage file: a photo uploaded on /submit but
// never submitted, one removed or replaced in the admin editor, and the photos
// of a deleted listing all stay in the bucket, still public to anyone holding
// the URL. anon has no delete policy and storage.protect_delete blocks SQL
// deletes, so this goes through the Storage API with the service-role key.
//
// A file is deleted only when ALL of these hold:
//   - its name is a real upload (uploads/<uuid>.<jpg|jpeg|png|webp>), so the
//     folder placeholder and anything added by hand are never touched;
//   - no row in Opportunities — any status, including pending and rejected —
//     mentions it in cover_image_url or gallery_image_urls;
//   - it is older than GRACE_HOURS. Photos upload the moment they are picked,
//     before the form is sent or the editor is saved, so a brand-new file with
//     no row yet is normal and must be left alone.
// Any failed read aborts before deleting anything; an empty listings table is
// treated as a failed read, since deleting every photo is never the right
// answer.
//
// ?dry=1 (or {"dryRun": true}) reports what would be deleted without deleting.

const crypto = require('crypto');
const { checkAdminPassword } = require('../lib/adminAuth');

function restBase(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u.endsWith('/')) u += '/';
  if (!/\/rest\/v1\/$/.test(u)) u += 'rest/v1/';
  return u;
}

const SUPABASE_REST = restBase(process.env.SUPABASE_URL);
const STORAGE       = SUPABASE_REST ? SUPABASE_REST.replace(/rest\/v1\/$/, 'storage/v1/') : null;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET   = process.env.CRON_SECRET;
const BUCKET        = 'opportunity-images';
const FOLDER        = 'uploads';
const GRACE_HOURS   = 24;
const UPLOAD_NAME   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

function supaHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
}

async function listUploads() {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(STORAGE + 'object/list/' + BUCKET, {
      method: 'POST',
      headers: supaHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: FOLDER, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error('Could not list photos (HTTP ' + r.status + ')');
    const page = await r.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

// Every photo file name any listing mentions, whatever its status.
async function namesInUse() {
  const used = new Set();
  let rows = 0;
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(SUPABASE_REST + 'Opportunities?select=cover_image_url,gallery_image_urls&order=id.asc',
      { headers: supaHeaders({ Range: offset + '-' + (offset + 999), 'Range-Unit': 'items' }) });
    if (!r.ok) throw new Error('Could not read listings (HTTP ' + r.status + ')');
    const page = await r.json();
    rows += page.length;
    const text = JSON.stringify(page);
    for (const m of text.matchAll(/\/uploads\/([^/"?#\\]+)/g)) used.add(m[1]);
    if (page.length < 1000) break;
  }
  if (rows === 0) throw new Error('No listings found, refusing to delete anything');
  return used;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Same two ways in as /api/send-digest: the cron secret (compared in
  // constant time) or the shared, rate-limited admin password check.
  const authHeader = req.headers.authorization;
  const cronOk = CRON_SECRET && typeof authHeader === 'string' &&
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(authHeader).digest(),
      crypto.createHash('sha256').update('Bearer ' + CRON_SECRET).digest()
    );
  if (!cronOk) {
    const denied = checkAdminPassword(req, req.headers['x-admin-password']);
    if (denied) return res.status(denied.status).json(denied.body);
  }
  if (!SUPABASE_REST || !SUPABASE_KEY) return res.status(500).json({ error: 'Server is missing its Supabase settings.' });

  const dryRun = req.query && (req.query.dry === '1' || req.query.dry === 'true') ||
                 (req.body && req.body.dryRun === true);

  let files, used;
  try {
    [files, used] = await Promise.all([listUploads(), namesInUse()]);
  } catch (err) {
    console.error('cleanup-photos aborted:', err.message);
    return res.status(502).json({ error: err.message + '. Nothing was deleted.' });
  }

  const cutoff = Date.now() - GRACE_HOURS * 60 * 60 * 1000;
  const unused = [];
  let inUse = 0, recent = 0;
  for (const f of files) {
    if (!UPLOAD_NAME.test(f.name)) continue;
    if (used.has(f.name)) { inUse++; continue; }
    const created = Date.parse(f.created_at || f.updated_at || '');
    if (!isFinite(created) || created > cutoff) { recent++; continue; }
    unused.push({ name: f.name, bytes: (f.metadata && f.metadata.size) || null, created_at: f.created_at });
  }

  const summary = { inUse, keptRecent: recent, graceHours: GRACE_HOURS };
  if (dryRun || !unused.length) {
    return res.status(200).json(Object.assign({ ok: true, dryRun: !!dryRun, wouldDelete: unused, deleted: [] }, summary));
  }

  const deleted = [];
  for (let i = 0; i < unused.length; i += 100) {
    const batch = unused.slice(i, i + 100);
    const r = await fetch(STORAGE + 'object/' + BUCKET, {
      method: 'DELETE',
      headers: supaHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: batch.map(f => FOLDER + '/' + f.name) }),
    });
    if (!r.ok) {
      console.error('cleanup-photos delete failed:', r.status, await r.text().catch(() => ''));
      return res.status(502).json(Object.assign({ error: 'Deleting failed partway (HTTP ' + r.status + ').', deleted }, summary));
    }
    const gone = await r.json().catch(() => []);
    const goneNames = new Set((Array.isArray(gone) ? gone : []).map(o => String(o.name || '').replace(FOLDER + '/', '')));
    batch.forEach(f => { if (goneNames.has(f.name)) deleted.push(f); });
  }
  console.log('cleanup-photos deleted', deleted.length, 'unused photo(s):', deleted.map(f => f.name).join(', '));
  return res.status(200).json(Object.assign({ ok: true, dryRun: false, deleted }, summary));
};
