// The "something arrived" emails to hello.elpys@gmail.com from api/submit.js
// and api/feedback.js (lib/adminAlert.js), with sendEmail mocked: they go out
// only after a saved row, never for a rejected request, never change what the
// visitor gets back, and escape whatever the visitor typed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.SUPABASE_URL = 'https://example.supabase.co/rest/v1/';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret';

// Replace lib/sendEmail.js before anything requires it.
const sent = [];
let sendImpl = async () => {};
require.cache[path.resolve(__dirname, '../lib/sendEmail.js')] = {
  id: 'sendEmail', filename: path.resolve(__dirname, '../lib/sendEmail.js'), loaded: true,
  exports: async (mail) => { sent.push(mail); return sendImpl(mail); },
};
const alert = require('../lib/adminAlert');
const submit = require('../api/submit');
const feedback = require('../api/feedback');

let insertOk = true;
global.fetch = async (url, opts = {}) => {
  const json = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data),
                                    headers: { get: () => null } });
  url = String(url);
  if (url.includes('challenges.cloudflare.com')) return json(200, { success: JSON.parse(opts.body).response === 'good' });
  if (url.includes('/rest/v1/Opportunities?name=ilike')) return json(200, []);
  if (url.includes('/rest/v1/Opportunities')) return insertOk ? json(201, [{ id: 4242 }]) : json(500, { message: 'nope' });
  if (url.includes('/rest/v1/Feedback')) return insertOk ? json(201, null) : json(500, { message: 'nope' });
  return json(500, {});   // geocoder: fails, which submit treats as non-fatal
};

let ipN = 0;
function call(handler, body) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
                  json(b) { resolve({ status: this.statusCode, body: b }); }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { 'x-forwarded-for': '10.0.0.' + (++ipN) }, body }, res);
  });
}
const listing = (extra) => Object.assign({
  name: 'Park Cleanup', description: 'Pick up litter', category: 'environment, community', age_display: '13+',
  when: 'Saturdays', where: 'Crossroads Park', address: '16000 NE 10th St, Bellevue, WA', section: 'online',
  signup_link: 'https://example.org', signup_steps: 'Sign up | Show up', opportunity_type: 'one_time', event_date: '2099-05-01',
  contact_email: 'organizer@example.org', contact_phone: '555-0100',
  cover_image_url: 'https://example.supabase.co/storage/v1/object/public/opportunity-images/uploads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
  gallery_image_urls: ['https://example.supabase.co/storage/v1/object/public/opportunity-images/uploads/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png'],
  'cf-turnstile-response': 'good',
}, extra);
function reset() { sent.length = 0; sendImpl = async () => {}; insertOk = true; alert._resetFloodForTests(); }

test('a saved submission emails hello.elpys once, with the details and the review link', async () => {
  reset();
  const r = await call(submit, listing());
  assert.deepStrictEqual(r, { status: 200, body: { ok: true } });
  assert.strictEqual(sent.length, 1);
  const m = sent[0];
  assert.strictEqual(m.to, 'hello.elpys@gmail.com');
  assert.strictEqual(m.subject, 'New Elpys submission: Park Cleanup');
  for (const part of [m.html, m.text]) {
    assert.match(part, /Park Cleanup/);
    assert.match(part, /Community, Environment/);
    assert.match(part, /One-time, 2099-05-01/);
    assert.match(part, /https:\/\/elpys\.vercel\.app\/admin-review\?id=4242/);
    assert.doesNotMatch(part, /organizer@example\.org|555-0100/);
  }
  assert.match(m.text, /Photos: 2\n/);
  assert.match(m.html, />Photos<\/td><td[^>]*>2<\/td>/);
  assert.doesNotMatch(m.subject, /organizer|555/);
});

test('recurring listings say so', async () => {
  reset();
  await call(submit, listing({ name: 'Weekly Thing', opportunity_type: 'recurring', event_date: undefined }));
  assert.match(sent[0].text, /When: Recurring/);
});

test('saved feedback emails hello.elpys that feedback arrived, never its text or the sender\'s email', async () => {
  reset();
  const msg = 'My name is Sam, I live at 12 Oak St <b>bold</b> ' + 'x'.repeat(50);
  const r = await call(feedback, { message: msg, contact_email: 'teen@example.com', page_url: '/earthcorps', 'cf-turnstile-response': 'good' });
  assert.deepStrictEqual(r, { status: 200, body: { ok: true } });
  assert.strictEqual(sent.length, 1);
  const m = sent[0];
  assert.strictEqual(m.to, 'hello.elpys@gmail.com');
  assert.strictEqual(m.subject, 'New Elpys feedback');
  const all = m.html + m.text + m.subject;
  for (const leak of [/Sam/, /Oak St/, /bold/, /xxxxx/, /teen@example\.com/, /earthcorps/]) assert.doesNotMatch(all, leak);
  assert.match(m.html, /https:\/\/elpys\.vercel\.app\/admin-feedback/);
  assert.match(m.text, /https:\/\/elpys\.vercel\.app\/admin-feedback/);
});

test('HTML in a listing name is escaped in the email, and the subject stays one plain line', async () => {
  reset();
  await call(submit, listing({ name: '<img src=x onerror=alert(1)>\nInjected: yes' }));
  assert.strictEqual(sent.length, 1);
  assert.doesNotMatch(sent[0].html, /<img src=x/);
  assert.match(sent[0].html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(sent[0].subject, /[\r\n]/);
});

test('a very long name is trimmed in the subject', async () => {
  reset();
  await call(submit, listing({ name: 'N'.repeat(190) }));
  assert.ok(sent[0].subject.length <= 100, sent[0].subject.length);
  assert.match(sent[0].subject, /^New Elpys submission: N+…$/);
});

test('nothing is sent for a failed insert, the honeypot, a failed Turnstile, or the rate limit', async () => {
  reset();
  insertOk = false;
  assert.strictEqual((await call(submit, listing())).status, 500);
  assert.strictEqual((await call(feedback, { message: 'hi', 'cf-turnstile-response': 'good' })).status, 500);
  insertOk = true;
  assert.deepStrictEqual(await call(submit, listing({ website: 'bot' })), { status: 200, body: { ok: true } });
  assert.deepStrictEqual(await call(feedback, { message: 'hi', website: 'bot' }), { status: 200, body: { ok: true } });
  assert.strictEqual((await call(submit, listing({ 'cf-turnstile-response': 'bad' }))).status, 400);
  assert.strictEqual((await call(feedback, { message: 'hi', 'cf-turnstile-response': 'bad' })).status, 400);
  assert.strictEqual(sent.length, 0);

  // Rate limit: same IP until it's refused. Only the accepted ones email.
  const ip = '10.9.9.9';
  const one = (handler, body) => new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve(this.statusCode); } };
    handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body }, res);
  });
  const codes = [];
  for (let i = 0; i < 16; i++) codes.push(await one(feedback, { message: 'm' + i, 'cf-turnstile-response': 'good' }));
  assert.strictEqual(codes.filter(c => c === 429).length, 1);
  assert.strictEqual(sent.length, 15);
});

test('a thrown or slow sendEmail changes nothing for the visitor', async () => {
  reset();
  sendImpl = async () => { throw new Error('SMTP down'); };
  const errLog = console.error; console.error = () => {};
  const a = await call(submit, listing({ name: 'Throws' }));
  const b = await call(feedback, { message: 'hi', 'cf-turnstile-response': 'good' });
  console.error = errLog;
  assert.deepStrictEqual(a, { status: 200, body: { ok: true } });
  assert.deepStrictEqual(b, { status: 200, body: { ok: true } });

  sendImpl = () => new Promise(() => {});   // never settles
  const warn = console.warn; console.warn = () => {};
  const t0 = Date.now();
  const c = await call(feedback, { message: 'slow', 'cf-turnstile-response': 'good' });
  console.warn = warn;
  const waited = Date.now() - t0;
  assert.deepStrictEqual(c, { status: 200, body: { ok: true } });
  assert.ok(waited >= 2900 && waited < 4000, 'waited ' + waited + 'ms');
});

test('the wait never runs past the request\'s time budget', async () => {
  reset();
  sendImpl = () => new Promise(() => {});
  const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
  const t0 = Date.now();
  await alert.sendVisitorAlert({ subject: 's', html: 'h', text: 't' }, Date.now() - 8800, 'test');
  console.warn = warn;
  assert.ok(Date.now() - t0 < 100);
  assert.match(warned.join('\n'), /not enough time left/);
});

test('flood cap: at most 30 alerts per 24 hours per instance, then skipped and logged', async () => {
  reset();
  const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
  for (let i = 0; i < 32; i++) await alert.sendVisitorAlert({ subject: 's' + i, html: 'h', text: 't' }, Date.now(), 'test');
  console.warn = warn;
  assert.strictEqual(sent.length, 30);
  assert.strictEqual(warned.filter(w => /30 already sent in the last 24h/.test(w)).length, 2);
});
