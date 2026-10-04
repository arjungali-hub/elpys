// api/send-digest.js matches a saved interest (display case, as the
// checkboxes on /signup and /account save it: "Education", "Mental health")
// against a listing's category (stored lowercase, comma-separated). A
// category that wasn't one of the original four must work the same way.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.CRON_SECRET = 'cron';

const sent = [];
require.cache[path.resolve(__dirname, '../lib/sendEmail.js')] = {
  id: 'sendEmail', filename: path.resolve(__dirname, '../lib/sendEmail.js'), loaded: true,
  exports: async (mail) => { sent.push(mail); },
};
const handler = require('../api/send-digest');

const future = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
const listing = (id, name, category) => ({ id, name, category, description: 'd', slug: name.toLowerCase().replace(/ /g, '-'),
                                           when: '', opportunity_type: 'one_time', event_date: future });
const OPPS = [listing(1, 'Tutoring Club', 'education'), listing(2, 'Peer Support', 'community, mental health'),
              listing(3, 'Dog Walk', 'animals'), listing(4, 'Edited By Hand', 'Education')];
const PROFILES = [
  { id: 'a', email: 'a@example.com', interests: ['Community', 'Education'], availability: {} },   // as account.html saves it
  { id: 'b', email: 'b@example.com', interests: ['Mental health'], availability: {} },
  { id: 'c', email: 'c@example.com', interests: ['Food'], availability: {} },
];
global.fetch = async (url) => {
  const json = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  if (String(url).includes('/Opportunities')) return json(OPPS);
  if (String(url).includes('/profiles')) return json(PROFILES);
  throw new Error('unexpected fetch ' + url);
};

test('new and multi-word categories match saved interests regardless of case', async () => {
  const l = console.log; console.log = () => {};
  const r = await new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    handler({ method: 'GET', headers: { authorization: 'Bearer cron' }, query: {} }, res);
  });
  console.log = l;
  assert.strictEqual(r.status, 200);
  const to = who => sent.find(m => m.to === who);
  assert.ok(to('a@example.com'), 'Education subscriber got no digest');
  assert.match(to('a@example.com').text, /Tutoring Club/);
  assert.match(to('a@example.com').text, /Edited By Hand/);          // "Education" stored mixed-case
  assert.match(to('a@example.com').text, /Peer Support/);            // via Community
  assert.doesNotMatch(to('a@example.com').text, /Dog Walk/);
  assert.match(to('b@example.com').text, /Peer Support/);            // "Mental health" vs "mental health"
  assert.doesNotMatch(to('b@example.com').text, /Tutoring Club/);
  assert.strictEqual(to('c@example.com'), undefined);
});
