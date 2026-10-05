// api-fetch.js ElpysForm: what someone typed survives the round-trip through
// Vercel's security check — and the honeypot, Turnstile token, passwords and
// file inputs are never saved. Uses a minimal stand-in for the page (no
// browser needed).
const test = require('node:test');
const assert = require('node:assert');

const store = new Map();
globalThis.sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.location = { pathname: '/submit', search: '', hash: '' };
const { ElpysForm, ElpysApi } = require('../api-fetch.js');

function el(props) {
  const e = Object.assign({ id: '', name: '', type: 'text', value: '', checked: false, events: [] }, props);
  e.dispatchEvent = ev => { e.events.push(ev.type); return true; };
  return e;
}
function page() {
  const els = [
    el({ id: 'f-name', name: 'name', value: 'Park Cleanup' }),
    el({ id: 'f-description', name: 'description', type: 'textarea', value: 'Line one\nLine two' }),
    el({ name: 'category', type: 'checkbox', value: 'Food', checked: true }),
    el({ name: 'category', type: 'checkbox', value: 'Animals', checked: false }),
    el({ name: 'opportunity_type', type: 'radio', value: 'one_time', checked: true }),
    el({ name: 'opportunity_type', type: 'radio', value: 'recurring', checked: false }),
    el({ id: 'f-event-date', name: 'event_date', type: 'date', value: '2026-11-14' }),
    el({ id: 'hp-website', name: 'website', value: 'bot-bait' }),
    el({ name: 'cf-turnstile-response', type: 'hidden', value: 'spent-token' }),
    el({ id: 'pw', name: 'password', type: 'password', value: 'secret' }),
    el({ id: 'f-cover-photo', type: 'file', value: 'C:\\fakepath\\a.jpg' }),
  ];
  return { els, querySelectorAll: () => els };
}

test('save then restore puts every typed value back and fires change/input', () => {
  store.clear();
  const before = page();
  ElpysForm.save(before, 'submit', { cover: 'https://x/uploads/a.jpg', gallery: ['g1'] });

  const after = page();
  after.els.forEach(e => { if (e.type === 'checkbox' || e.type === 'radio') e.checked = !e.checked; else e.value = ''; });
  const back = ElpysForm.restore(after, 'submit');

  assert.deepStrictEqual(back.extra, { cover: 'https://x/uploads/a.jpg', gallery: ['g1'] });
  const get = i => after.els[i];
  assert.strictEqual(get(0).value, 'Park Cleanup');
  assert.strictEqual(get(1).value, 'Line one\nLine two');
  assert.strictEqual(get(2).checked, true);
  assert.strictEqual(get(3).checked, false);
  assert.strictEqual(get(4).checked, true);
  assert.strictEqual(get(5).checked, false);
  assert.strictEqual(get(6).value, '2026-11-14');
  assert.ok(get(0).events.includes('input') && get(0).events.includes('change'));
  assert.ok(get(4).events.includes('change'));
});

test('the honeypot, Turnstile token, passwords and files are never saved', () => {
  store.clear();
  ElpysForm.save(page(), 'submit');
  const saved = [...store.values()].join('');
  for (const secret of ['bot-bait', 'spent-token', 'secret', 'fakepath']) assert.ok(!saved.includes(secret), secret);
  const after = page();
  after.els.forEach(e => { e.value = ''; });
  ElpysForm.restore(after, 'submit');
  assert.strictEqual(after.els[7].value, '');
  assert.strictEqual(after.els[8].value, '');
  assert.strictEqual(after.els[9].value, '');
});

test('clear() removes the saved copy (after a successful send)', () => {
  store.clear();
  ElpysForm.save(page(), 'submit', { a: 1 });
  assert.ok(ElpysForm.peek('submit'));
  ElpysForm.clear('submit');
  assert.strictEqual(ElpysForm.peek('submit'), null);
  assert.strictEqual(ElpysForm.restore(page(), 'submit'), null);
});

test('a copy older than an hour is ignored and dropped', () => {
  store.clear();
  ElpysForm.save(page(), 'submit');
  const key = [...store.keys()][0];
  const d = JSON.parse(store.get(key)); d.at = Date.now() - 2 * 60 * 60 * 1000; store.set(key, JSON.stringify(d));
  assert.strictEqual(ElpysForm.restore(page(), 'submit'), null);
  assert.strictEqual(store.has(key), false);
});

test('justReturned() is decided when the page loads: true only just after a round-trip', () => {
  const fresh = () => { delete require.cache[require.resolve('../api-fetch.js')]; return require('../api-fetch.js').ElpysApi; };
  store.clear();
  assert.strictEqual(fresh().justReturned(), false);
  store.set('elpys_checkpoint_at', String(Date.now()));
  const api = fresh();
  assert.strictEqual(api.justReturned(), true);
  store.delete('elpys_checkpoint_at');            // e.g. the page's own data load
  assert.strictEqual(api.justReturned(), true);   // still true for this page load
  store.set('elpys_checkpoint_at', String(Date.now() - 10 * 60 * 1000));
  assert.strictEqual(fresh().justReturned(), false);
});
