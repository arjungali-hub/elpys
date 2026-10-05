// Shared fetch() for every call the pages make to /api/*, plus recovery from
// Vercel's automatic bot check.
//
// Vercel's platform bot mitigation sometimes answers a fetch() with
// `403` + `x-vercel-mitigated: challenge` and an HTML "Security Checkpoint"
// page instead of reaching our function (seen 2026-10-04 on /api/submit and
// /api/admin from an automated browser; the project has no firewall rules of
// its own, so this is Vercel's default protection). A fetch() can't run that
// page's check, so retrying just fails again, and the visitor was shown
// "Something went wrong: HTTP 403".
//
// What this does instead, in order:
//   1. ElpysApi.fetch() spots the challenge (isChallenge below).
//   2. The page's own save hook runs (opts.save), so nothing typed is lost:
//      ElpysForm.save() keeps the text fields in sessionStorage.
//   3. A plain message is shown, then the browser goes to /api/checkpoint as a
//      normal page load. That is an /api/ URL, so Vercel shows its checkpoint
//      there, where a real browser can pass it; our function then redirects
//      straight back to the page.
//   4. Back on the page, the page restores what was saved. Turnstile tokens are
//      single-use, so the page has a fresh widget and the person passes it
//      again before re-sending.
//   5. If the very next call is challenged again, it stops instead of looping
//      and says so.
//
// While the browser is leaving, ElpysApi.fetch() returns a promise that never
// settles, so the caller's "Sending…" state stays put instead of flashing an
// error. In the no-loop case it throws an Error with a message the caller can
// show as-is.
(function (root) {
  var LOOP_KEY     = 'elpys_checkpoint_at';
  var LOOP_WINDOW  = 5 * 60 * 1000;   // a challenge this soon after a round-trip is a loop
  var GOING_MSG    = 'Your browser needs a quick security check. We’ll bring you straight back.';
  var STUCK_MSG    = 'We couldn’t verify your browser. Please try again in a minute or email hello.elpys@gmail.com.';

  function ss() { try { return root.sessionStorage; } catch (_) { return null; } }

  // A 403 that Vercel's edge sent rather than our code. Our functions only
  // ever answer in JSON, so a 403 that isn't JSON is the checkpoint too, even
  // if the header is missing.
  function isChallenge(res) {
    if (!res || res.status !== 403) return false;
    var h = res.headers;
    if (h && typeof h.get === 'function') {
      if (String(h.get('x-vercel-mitigated') || '').toLowerCase() === 'challenge') return true;
      var type = String(h.get('content-type') || '').toLowerCase();
      return type.indexOf('application/json') === -1;
    }
    return false;
  }

  // The message to show for a failed response whose body isn't JSON (Vercel's
  // own error pages): plain words instead of a raw "HTTP 500".
  function plainError(res) {
    var type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
    if (type.indexOf('application/json') !== -1) return null;
    if (res.status >= 500) return PLAIN_5XX;
    return null;
  }
  var PLAIN_5XX = 'The site had a problem — please try again.';

  function banner(text, kind) {
    var doc = root.document;
    if (!doc || !doc.body) return;
    var el = doc.getElementById('checkpoint-banner');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'checkpoint-banner';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      doc.body.appendChild(el);
    }
    el.className = 'checkpoint-banner' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  function recentlyChecked() {
    var s = ss(); if (!s) return false;
    var at = parseInt(s.getItem(LOOP_KEY) || '', 10);
    return isFinite(at) && Date.now() - at < LOOP_WINDOW;
  }

  // Where the browser goes to pass the check. Same origin, so the page's own
  // path (and query) is all that is needed to come back.
  function checkpointUrl() {
    var loc = root.location;
    return '/api/checkpoint?return=' + encodeURIComponent(loc.pathname + loc.search + loc.hash);
  }

  // Sends the browser through the checkpoint, or gives up if it just did.
  // Returns a promise for ElpysApi.fetch() to hand back to its caller.
  var leaving = false;
  function handleChallenge(opts) {
    // Another call challenged while this page is already on its way out: it
    // is part of the same trip, not a loop.
    if (leaving) return new Promise(function () {});
    if (recentlyChecked()) {
      var s = ss(); if (s) s.removeItem(LOOP_KEY);
      banner(STUCK_MSG, 'error');
      var err = new Error(STUCK_MSG);
      err.checkpointStuck = true;
      return Promise.reject(err);
    }
    try { if (opts && typeof opts.save === 'function') opts.save(); }
    catch (e) { if (root.console) console.error('Could not save the form before the security check:', e); }
    leaving = true;
    var st = ss(); if (st) st.setItem(LOOP_KEY, String(Date.now()));
    banner(GOING_MSG);
    if (opts && typeof opts.onLeave === 'function') { try { opts.onLeave(GOING_MSG); } catch (_) {} }
    setTimeout(function () { root.location.assign(checkpointUrl()); }, (opts && opts.delayMs != null) ? opts.delayMs : 1200);
    return new Promise(function () {});   // the page is leaving
  }

  // fetch() for /api/* calls. opts.save runs before leaving for the check.
  function apiFetch(url, init, opts) {
    return root.fetch(url, init).then(function (res) {
      if (isChallenge(res)) return handleChallenge(opts);
      // A send (not just a page loading its data) got through, so the earlier
      // round-trip is finished: the next challenge, however soon, is a fresh
      // one rather than a loop.
      var method = String((init && init.method) || 'GET').toUpperCase();
      if (method !== 'GET' && res.status !== 403) { var s = ss(); if (s) s.removeItem(LOOP_KEY); }
      return res;
    });
  }

  // ── Keeping a form through the round-trip ──────────────────────────────────
  // Text-like inputs, textareas, selects, checkboxes and radios, keyed by id
  // (or name + value for unnamed-id checkboxes/radios). Never file inputs,
  // passwords, the honeypot, or Turnstile's token (single-use; a new one is
  // needed after coming back anyway). `extra` is page state that isn't a field
  // — uploaded photo URLs, the schedule grid — returned as-is by restore().
  var SKIP_NAMES = { 'cf-turnstile-response': 1, website: 1 };
  function fieldKey(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return (el.id ? '#' + el.id : el.name + '=' + el.value);
    return el.id ? '#' + el.id : (el.name ? el.name : null);
  }
  function fields(container) {
    return Array.prototype.filter.call(container.querySelectorAll('input, textarea, select'), function (el) {
      if (el.type === 'file' || el.type === 'password' || el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
      if (SKIP_NAMES[el.name] || el.id === 'hp-website') return false;
      return !!fieldKey(el);
    });
  }
  function storageKey(key) { return 'elpys_form_' + key + ':' + root.location.pathname + root.location.search; }

  var ElpysForm = {
    save: function (container, key, extra) {
      if (!container) return;
      var data = { v: {}, extra: extra == null ? null : extra, at: Date.now() };
      fields(container).forEach(function (el) {
        data.v[fieldKey(el)] = (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : el.value;
      });
      var s = ss(); if (s) s.setItem(storageKey(key), JSON.stringify(data));
    },
    // Puts saved values back and fires input/change so the page's own
    // listeners (show/hide fields, counters) run. Returns { extra } or null.
    restore: function (container, key) {
      var s = ss(); if (!s || !container) return null;
      var raw = s.getItem(storageKey(key)); if (!raw) return null;
      var data; try { data = JSON.parse(raw); } catch (_) { return null; }
      if (!data || !data.v || Date.now() - (data.at || 0) > 60 * 60 * 1000) { s.removeItem(storageKey(key)); return null; }
      var all = fields(container);
      // Radios and checkboxes first, so dependent fields are shown before
      // their values are put back.
      all.sort(function (a, b) {
        var ca = (a.type === 'checkbox' || a.type === 'radio') ? 0 : 1;
        var cb = (b.type === 'checkbox' || b.type === 'radio') ? 0 : 1;
        return ca - cb;
      });
      all.forEach(function (el) {
        var k = fieldKey(el);
        if (!(k in data.v)) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked === data.v[k]) return;
          el.checked = data.v[k];
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.value = data.v[k];
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return { extra: data.extra };
    },
    // The saved page state (extra) without touching any field, or null.
    peek: function (key) {
      var s = ss(); if (!s) return null;
      try { var d = JSON.parse(s.getItem(storageKey(key)) || 'null'); return d && Date.now() - (d.at || 0) <= 60 * 60 * 1000 ? { extra: d.extra } : null; }
      catch (_) { return null; }
    },
    clear: function (key) { var s = ss(); if (s) s.removeItem(storageKey(key)); },
  };

  // True if this page load is the return from a round-trip through the
  // checkpoint: the page restores what was saved only then, not on every
  // visit. Decided once, when the page loads, so the page's own data loading
  // can't change the answer before the restore code asks.
  var returnedAtLoad = recentlyChecked();
  function justReturned() { return returnedAtLoad; }

  var ElpysApi = { fetch: apiFetch, isChallenge: isChallenge, plainError: plainError, banner: banner, justReturned: justReturned,
                   GOING_MSG: GOING_MSG, STUCK_MSG: STUCK_MSG, PLAIN_5XX: PLAIN_5XX };
  root.ElpysApi = ElpysApi;
  root.ElpysForm = ElpysForm;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ElpysApi: ElpysApi, ElpysForm: ElpysForm };
})(typeof window !== 'undefined' ? window : globalThis);
