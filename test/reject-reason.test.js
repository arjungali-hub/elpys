// The Reject reason from admin-review.html's dialog reaches api/admin.js,
// is stored trimmed in rejection_reason, empty becomes null, and anything over
// 500 characters is refused before any write.
const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = 'https://example.supabase.co/rest/v1/';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ADMIN_PASSWORD = 'pw';
const handler = require('../api/admin');

let patches;
global.fetch = async (url, opts = {}) => {
  if (opts.method === 'PATCH') {
    patches.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 7 }]), json: async () => [{ id: 7 }] };
  }
  throw new Error('unexpected fetch ' + url);
};
function reject(body) {
  patches = [];
  return new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
                  json(b) { resolve({ status: this.statusCode, body: b }); }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { 'x-admin-password': 'pw', 'x-forwarded-for': '10.1.1.1' }, query: {},
              body: Object.assign({ action: 'reject', id: 7 }, body) }, res);
  });
}

test('the reason is stored, trimmed, with status rejected', async () => {
  const r = await reject({ reason: '  private residence; no registered charity found \n' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(patches.length, 1);
  assert.match(patches[0].url, /Opportunities\?id=eq\.7$/);
  assert.strictEqual(patches[0].body.status, 'rejected');
  assert.strictEqual(patches[0].body.rejection_reason, 'private residence; no registered charity found');
  assert.ok(patches[0].body.rejected_at);
});

test('a blank or missing reason is stored as null', async () => {
  for (const body of [{ reason: '   ' }, {}, { reason: 42 }]) {
    const r = await reject(body);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(patches[0].body.rejection_reason, null, JSON.stringify(body));
  }
});

test('500 characters is accepted; 501 is refused and nothing is written', async () => {
  let r = await reject({ reason: 'x'.repeat(500) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(patches[0].body.rejection_reason.length, 500);
  r = await reject({ reason: 'x'.repeat(501) });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /500 characters/);
  assert.strictEqual(patches.length, 0);
});

test('markup in a reason is stored as typed (the Rejected list escapes it)', async () => {
  await reject({ reason: '<b>x</b>' });
  assert.strictEqual(patches[0].body.rejection_reason, '<b>x</b>');
});
