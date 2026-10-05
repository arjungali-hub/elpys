// api-fetch.js: telling Vercel's bot-check 403 apart from our own errors, and
// /api/checkpoint only ever redirecting back within the site.
const test = require('node:test');
const assert = require('node:assert');
const { ElpysApi } = require('../api-fetch.js');
const { safeReturn } = require('../lib/checkpoint');

const res = (status, headers) => ({ status, headers: new Headers(headers || {}) });

test('403 with x-vercel-mitigated: challenge is a challenge', () => {
  assert.strictEqual(ElpysApi.isChallenge(res(403, { 'x-vercel-mitigated': 'challenge', 'content-type': 'text/html; charset=utf-8' })), true);
  assert.strictEqual(ElpysApi.isChallenge(res(403, { 'x-vercel-mitigated': 'Challenge' })), true);
});

test('a 403 that is not JSON is treated as the checkpoint too', () => {
  assert.strictEqual(ElpysApi.isChallenge(res(403, { 'content-type': 'text/html' })), true);
  assert.strictEqual(ElpysApi.isChallenge(res(403, {})), true);
});

test('our own JSON 403s and other errors are not challenges', () => {
  assert.strictEqual(ElpysApi.isChallenge(res(403, { 'content-type': 'application/json; charset=utf-8' })), false);
  assert.strictEqual(ElpysApi.isChallenge(res(400, { 'content-type': 'application/json' })), false);
  assert.strictEqual(ElpysApi.isChallenge(res(400, { 'content-type': 'text/html' })), false);
  assert.strictEqual(ElpysApi.isChallenge(res(200, { 'x-vercel-mitigated': 'challenge' })), false);
  assert.strictEqual(ElpysApi.isChallenge(res(429, {})), false);
});

test('a non-JSON 5xx gets a plain message; JSON errors keep their own', () => {
  assert.match(ElpysApi.plainError(res(500, { 'content-type': 'text/html' })), /The site had a problem/);
  assert.match(ElpysApi.plainError(res(502, {})), /The site had a problem/);
  assert.strictEqual(ElpysApi.plainError(res(500, { 'content-type': 'application/json' })), null);
  assert.strictEqual(ElpysApi.plainError(res(404, { 'content-type': 'text/html' })), null);
});

test('/api/checkpoint only redirects to a path on this site', () => {
  assert.strictEqual(safeReturn('/submit'), '/submit');
  assert.strictEqual(safeReturn('/admin-review?id=12#top'), '/admin-review?id=12#top');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', undefined,
                     '/api/checkpoint?return=/x', '/x\r\nSet-Cookie: a=b', '/' + 'a'.repeat(600)]) {
    assert.strictEqual(safeReturn(bad), '/', String(bad));
  }
});

test('/api/checkpoint answers with a no-store redirect', () => {
  const handler = require('../lib/checkpoint');
  const out = { headers: {} };
  handler({ query: { return: '/feedback' } }, { setHeader(k, v) { out.headers[k] = v; }, end() { out.ended = true; }, set statusCode(c) { out.status = c; } });
  assert.strictEqual(out.status, 302);
  assert.strictEqual(out.headers.Location, '/feedback');
  assert.strictEqual(out.headers['Cache-Control'], 'no-store');
  assert.ok(out.ended);
});

test('/api/checkpoint is served by api/sitemap.js (rewrite in vercel.json; Hobby allows 12 functions)', () => {
  const sitemap = require('../api/sitemap');
  const out = { headers: {} };
  sitemap({ query: { checkpoint: '1', return: '/submit' } },
          { setHeader(k, v) { out.headers[k] = v; }, end() { out.ended = true; }, set statusCode(c) { out.status = c; } });
  assert.strictEqual(out.status, 302);
  assert.strictEqual(out.headers.Location, '/submit');
  const fs = require('fs');
  const rewrites = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8')).rewrites;
  assert.ok(rewrites.some(r => r.source === '/api/checkpoint' && r.destination === '/api/sitemap?checkpoint=1'));
  const functions = fs.readdirSync(require('path').join(__dirname, '../api')).filter(f => f.endsWith('.js'));
  assert.ok(functions.length <= 12, functions.length + ' functions in api/ — the Hobby plan allows 12');
});
