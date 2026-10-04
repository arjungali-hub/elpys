// api/review-alerts.js against a mocked Supabase, with sendEmail mocked: it
// emails hello.elpys once per new Data review / Analytics review item, never
// repeats one, and remembers nothing when the email fails.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ADMIN_PASSWORD = 'pw';
process.env.CRON_SECRET = 'cron';

const sent = [];
let sendImpl = async () => {};
require.cache[path.resolve(__dirname, '../lib/sendEmail.js')] = {
  id: 'sendEmail', filename: path.resolve(__dirname, '../lib/sendEmail.js'), loaded: true,
  exports: async (mail) => { sent.push(mail); return sendImpl(mail); },
};
const handler = require('../api/review-alerts');

const recent = new Date(Date.now() - 2 * 86400e3).toISOString();
let db;
function freshDb() {
  db = {
    up: true,
    flags: [{ id: 7, opportunity_id: 91, field: 'when', issue_summary: 'Hours changed to <10am–2pm>' }],
    names: { 91: 'Bellevue Farmers Market' },
    runs: {
      cloud_weekly:  { task_name: 'cloud_weekly', last_run_at: recent, status: 'ok', note: 'fine' },
      local_verify:  { task_name: 'local_verify', last_run_at: recent, status: 'ok', note: 'fine' },
      analytics_review_monthly: { task_name: 'analytics_review_monthly', last_run_at: recent, status: 'ok', note: 'fine', updated_at: recent },
    },
    review: { id: 3, redesign_prompts: [] },
    state: null,
  };
}
global.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (!db.up) return json(503, { message: 'paused' });
  const q = new URL(url).searchParams;
  if (url.includes('/task_runs') && opts.method === 'POST') {
    const row = JSON.parse(opts.body); db.state = row.note; return json(201, null);
  }
  if (url.includes('/Opportunities?select=id&limit=1')) return json(200, [{ id: 1 }]);
  if (url.includes('/Opportunities?id=in.')) return json(200, Object.entries(db.names).map(([id, name]) => ({ id: +id, name })));
  if (url.includes('/data_review_flags')) return json(200, db.flags);
  if (url.includes('/analytics_reviews')) return json(200, [db.review]);
  if (url.includes('/task_runs')) {
    const name = q.get('task_name');
    if (name === 'eq.review_alerts') return json(200, db.state == null ? [] : [{ note: db.state }]);
    if (name === 'eq.analytics_review_monthly') return json(200, [db.runs.analytics_review_monthly]);
    if (name === 'in.(cloud_weekly,local_verify)') return json(200, [db.runs.cloud_weekly, db.runs.local_verify]);
  }
  throw new Error('unexpected fetch ' + url);
};
function run(req) {
  return new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
                  json(b) { resolve({ status: this.statusCode, body: b }); } };
    handler(Object.assign({ method: 'GET', headers: { authorization: 'Bearer cron' }, query: {} }, req), res);
  });
}
const quiet = fn => async () => { const l = console.log; console.log = () => {}; try { await fn(); } finally { console.log = l; } };

test('a new flag is emailed once to hello.elpys, then not again while it waits', quiet(async () => {
  freshDb(); sent.length = 0;
  let r = await run({});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.emailed, 1);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'hello.elpys@gmail.com');
  assert.strictEqual(sent[0].subject, 'Elpys: 1 new item in Data review');
  assert.match(sent[0].text, /Bellevue Farmers Market \(when\): Hours changed/);
  assert.match(sent[0].text, /https:\/\/elpys\.vercel\.app\/review/);
  assert.match(sent[0].html, /&lt;10am–2pm&gt;/);
  assert.doesNotMatch(sent[0].html, /<10am/);

  r = await run({});
  assert.strictEqual(r.body.emailed, 0);
  assert.strictEqual(sent.length, 1);
}));

test('a new redesign suggestion and an overdue weekly check are new items; old ones are not repeated', quiet(async () => {
  freshDb(); sent.length = 0;
  await run({});                                   // the flag, emailed
  db.review.redesign_prompts = [{ id: 'p1', rank: 1, title: 'Shorter hero', acknowledged_at: null }];
  db.runs.cloud_weekly.last_run_at = new Date(Date.now() - 20 * 86400e3).toISOString();
  const r = await run({});
  assert.strictEqual(r.body.emailed, 2);
  const m = sent[1];
  assert.strictEqual(m.subject, 'Elpys: 2 new items in Data review and Analytics review');
  assert.match(m.text, /Weekly check is overdue/);
  assert.match(m.text, /Redesign suggestion ready: Shorter hero/);
  assert.match(m.text, /analytics-review/);
  assert.doesNotMatch(m.text, /Farmers Market/);    // already sent yesterday
}));

test('a failed monthly analytics run is an item', quiet(async () => {
  freshDb(); sent.length = 0; db.flags = [];
  db.runs.analytics_review_monthly.status = 'failed'; db.runs.analytics_review_monthly.note = 'PostHog token expired';
  await run({});
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Last run failed\. PostHog token expired/);
}));

test('nothing to do sends nothing; a flag that clears and comes back is new again', quiet(async () => {
  freshDb(); sent.length = 0;
  await run({});
  const flag = db.flags[0];
  db.flags = [];
  assert.strictEqual((await run({})).body.emailed, 0);
  db.flags = [flag];
  assert.strictEqual((await run({})).body.emailed, 1);
  assert.strictEqual(sent.length, 2);
}));

test('a failed email is not remembered, so the next run tries again', async () => {
  freshDb(); sent.length = 0;
  sendImpl = async () => { throw new Error('SMTP down'); };
  const e = console.error; console.error = () => {};
  const r = await run({});
  console.error = e;
  assert.strictEqual(r.status, 502);
  assert.strictEqual(db.state, null);
  sendImpl = async () => {};
  const l = console.log; console.log = () => {};
  assert.strictEqual((await run({})).body.emailed, 1);
  console.log = l;
});

test('Supabase down is emailed (and repeats daily until fixed)', async () => {
  freshDb(); sent.length = 0; db.up = false;
  const l = console.log; console.log = () => {};
  await run({}); await run({});
  console.log = l;
  assert.strictEqual(sent.length, 2);
  assert.match(sent[0].text, /Supabase is paused/);
});

test('dry run reports without sending or remembering; wrong credentials are refused', async () => {
  freshDb(); sent.length = 0;
  const r = await run({ headers: { 'x-admin-password': 'pw' }, query: { dry: '1' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.wouldEmail.length, 1);
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(db.state, null);
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-admin-password': 'nope' }]) {
    assert.strictEqual((await run({ headers })).status, 401);
  }
  assert.strictEqual(sent.length, 0);
});
