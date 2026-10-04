// api/cleanup-photos.js against a mocked Supabase: it must delete only old,
// unreferenced upload files, and delete nothing when any read fails.
const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ADMIN_PASSWORD = 'pw';
process.env.CRON_SECRET = 'cron';
const handler = require('../api/cleanup-photos');

const OLD = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
const NEW = new Date(Date.now() - 2 * 3600e3).toISOString();
const U = n => 'https://example.supabase.co/storage/v1/object/public/opportunity-images/uploads/' + n;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';   // cover of a published row
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp';  // gallery of a rejected row
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.png';   // unused, old  -> deleted
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg';   // unused, 2h old -> kept
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg';   // card thumbnail of A's row -> kept
const FILES = [A, B, C, D, T].map((name, i) => ({ name, created_at: i === 3 ? NEW : OLD, metadata: { size: 1000 } }))
  .concat([{ name: '.emptyFolderPlaceholder', created_at: OLD }, { name: 'by-hand.jpg', created_at: OLD }]);
const ROWS = [{ cover_image_url: U(A), cover_thumb_url: U(T), gallery_image_urls: [], name: 'not a photo column' },
              { cover_image_url: null, cover_thumb_url: null, gallery_image_urls: [U(B)] }];

function mockFetch({ rows = ROWS, rowsOk = true, listOk = true } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
    const json = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (url.includes('/storage/v1/object/list/')) return listOk ? json(200, FILES) : json(500, {});
    // Like PostgREST, return only the columns asked for, so a select that
    // forgets a photo column fails here the way it would in production.
    if (url.includes('/rest/v1/Opportunities')) {
      if (!rowsOk) return json(500, {});
      const cols = new URL(url).searchParams.get('select').split(',');
      return json(200, rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]]))));
    }
    if (opts.method === 'DELETE') return json(200, JSON.parse(opts.body).prefixes.map(p => ({ name: p })));
    throw new Error('unexpected fetch ' + url);
  };
  return calls;
}
function run(req) {
  return new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
                  json(b) { resolve({ status: this.statusCode, body: b }); } };
    handler(Object.assign({ headers: {}, query: {} }, req), res);
  });
}
const admin = { headers: { 'x-admin-password': 'pw' } };
const deletes = calls => calls.filter(c => c.method === 'DELETE');

test('dry run lists only the old, unused upload and deletes nothing', async () => {
  const calls = mockFetch();
  const r = await run(Object.assign({ query: { dry: '1' } }, admin));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.wouldDelete.map(f => f.name), [C]);
  assert.strictEqual(r.body.inUse, 3);
  assert.strictEqual(r.body.keptRecent, 1);
  assert.strictEqual(deletes(calls).length, 0);
});

test('real run deletes exactly that file, with the service-role key', async () => {
  const calls = mockFetch();
  const r = await run(admin);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.deleted.map(f => f.name), [C]);
  const d = deletes(calls);
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual(JSON.parse(d[0].body).prefixes, ['uploads/' + C]);
  assert.strictEqual(d[0].headers.Authorization, 'Bearer service-key');
});

test('the weekly cron secret is accepted', async () => {
  mockFetch();
  const r = await run({ headers: { authorization: 'Bearer cron' } });
  assert.strictEqual(r.status, 200);
});

test('no password, wrong password, or wrong cron secret is refused before any Supabase call', async () => {
  for (const headers of [{}, { 'x-admin-password': 'nope' }, { authorization: 'Bearer wrong' }]) {
    const calls = mockFetch();
    const r = await run({ headers });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(calls.length, 0);
  }
});

test('a failed listings read, an empty listings table, or a failed file list deletes nothing', async () => {
  for (const opts of [{ rowsOk: false }, { rows: [] }, { listOk: false }]) {
    const calls = mockFetch(opts);
    const r = await run(admin);
    assert.strictEqual(r.status, 502, JSON.stringify(opts));
    assert.match(r.body.error, /Nothing was deleted/);
    assert.strictEqual(deletes(calls).length, 0);
  }
});

test('a card thumbnail (cover_thumb_url) counts as in use and is never deleted', async () => {
  const calls = mockFetch();
  const r = await run(admin);
  assert.strictEqual(r.status, 200);
  const deleted = deletes(calls).flatMap(c => JSON.parse(c.body).prefixes);
  assert.ok(!deleted.includes('uploads/' + T), 'thumbnail was deleted');
  assert.deepStrictEqual(deleted, ['uploads/' + C]);
  const req = calls.find(c => c.url.includes('/rest/v1/Opportunities'));
  assert.match(new URL(req.url).searchParams.get('select'), /(^|,)cover_thumb_url(,|$)/);
});
