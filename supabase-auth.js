// Shared header auth updater — loaded on every public page after the Supabase SDK.
// Sets header buttons based on session state:
//   Logged out  → Log in + Sign up (static HTML, no change needed)
//   Normal user → My account + Log out
//   Admin       → Feedback + Edit opportunities + Approve opportunities

function showModal(opts) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box">' +
      '<button class="modal-close" aria-label="Close">×</button>' +
      '<p class="modal-title">' + opts.title + '</p>' +
      '<p class="modal-body">' + opts.body + '</p>' +
      '<div class="modal-actions">' +
        '<button class="modal-btn-cancel">Cancel</button>' +
        '<button class="modal-btn-action' + (opts.danger ? ' danger' : '') + '">' + opts.confirmText + '</button>' +
      '</div>' +
    '</div>';

  // Escape closes the dialog, and focus returns to whatever opened it.
  // The keydown listener is on document, so close() has to remove it —
  // otherwise every modal ever opened keeps listening for keys.
  var prevFocus = document.activeElement;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('.modal-btn-cancel').addEventListener('click', close);
  overlay.querySelector('.modal-btn-action').addEventListener('click', function () {
    close();
    opts.onConfirm();
  });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  document.body.appendChild(overlay);
  var box = overlay.querySelector('.modal-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  // Focus moves into the dialog so a keyboard user is not left tabbing the
  // page behind the overlay.
  (overlay.querySelector('.modal-btn-action') || box).focus();
}

(function () {
  var SUPA_URL  = 'https://ukrykzmehvghedrvmkjj.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcnlrem1laHZnaGVkcnZta2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODc4NzgsImV4cCI6MjA5ODk2Mzg3OH0.J1J4p3lTbQKMc3GvWVlBxAZZV1jGYPIU4Jj_ePLndgM';

  var authEl   = document.getElementById('header-auth-link');
  var signupEl = document.getElementById('header-signup-link');

  // ── Admin session (synchronous sessionStorage check) ─────────────────────
  var adminPw = sessionStorage.getItem('elpys_admin_pw');
  if (adminPw) {
    if (authEl)   authEl.style.display   = 'none';
    if (signupEl) signupEl.style.display = 'none';
    var submitEl = document.querySelector('.header-submit-link');
    if (submitEl) submitEl.style.display = 'none';

    var inner = document.querySelector('.header-inner');
    if (inner) {
      // Mode indicator, next to the wordmark so it reads as state rather than
      // as another nav item. It is inserted directly after .site-name, which
      // makes it the last element of the header's left group — styles.css
      // hands the margin-right:auto that splits left from right over to it
      // whenever it is present. (That spacer used to live on .beta-badge,
      // which sat here until the badge was removed at launch.)
      var adminBadge = document.createElement('span');
      adminBadge.className   = 'admin-badge';
      adminBadge.textContent = 'Admin';
      var siteName = inner.querySelector('.site-name');
      if (siteName && siteName.nextSibling) inner.insertBefore(adminBadge, siteName.nextSibling);
      else if (siteName) inner.appendChild(adminBadge);

      // ── Row 1: admin nav links ───────────────────────────────────────────
      var adminGroup = document.createElement('div');
      adminGroup.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-left:auto;';

      function makeAdminLink(text, href) {
        var a = document.createElement('a');
        a.href        = href;
        a.textContent = text;
        a.className   = 'header-admin-link';
        return a;
      }

      adminGroup.appendChild(makeAdminLink('Feedback',              '/admin-feedback'));
      adminGroup.appendChild(makeAdminLink('Approve opportunities', '/admin-approve'));

      // Data review carries a traffic light so the queue and the database's
      // health are visible without opening the page. Colour comes from the
      // server (/api/review?summary=1), which is the only thing that can see
      // the flag counts and reach Supabase.
      var reviewLink = makeAdminLink('Data review', '/review');
      var reviewDot  = document.createElement('span');
      reviewDot.className = 'status-dot is-unknown';
      reviewDot.setAttribute('aria-hidden', 'true');
      reviewLink.appendChild(reviewDot);
      adminGroup.appendChild(reviewLink);

      // Failures leave the dot in its neutral "unknown" state rather than
      // guessing green — a dot that lies about health is worse than no dot.
      fetch('/api/review?summary=1', { headers: { 'x-admin-password': adminPw } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.status) return;
          reviewDot.className = 'status-dot is-' + d.status.dot;
          // A tooltip is easy to miss if you don't already know there's
          // something to hover — this page's own Data review link says the
          // same thing in a panel that's always visible, not just on hover.
          var text = d.status.label + (d.status.detail ? ' — ' + d.status.detail : '') +
            ' (see Data review for details)';
          reviewLink.title = text;
          // Colour alone is not a signal for everyone, so the state is also
          // readable text for a screen reader.
          reviewDot.removeAttribute('aria-hidden');
          reviewDot.setAttribute('role', 'img');
          reviewDot.setAttribute('aria-label', 'Data review status: ' + text);
        })
        .catch(function () { /* dot stays neutral */ });

      // Analytics review carries its own independent traffic light, for the
      // same reason Data review does: the monthly analytics task can stop
      // running silently — no error, no failure row, just a last_run_at that
      // quietly stops moving — and this dot is the only place that surfaces
      // before someone thinks to go looking.
      var analyticsLink = makeAdminLink('Analytics review', '/analytics-review');
      var analyticsDot  = document.createElement('span');
      analyticsDot.className = 'status-dot is-unknown';
      analyticsDot.setAttribute('aria-hidden', 'true');
      analyticsLink.appendChild(analyticsDot);
      adminGroup.appendChild(analyticsLink);

      fetch('/api/analytics-review?summary=1', { headers: { 'x-admin-password': adminPw } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.status) return;
          analyticsDot.className = 'status-dot is-' + d.status.dot;
          var atext = d.status.label + (d.status.detail ? ' — ' + d.status.detail : '') +
            ' (see Analytics review for details)';
          analyticsLink.title = atext;
          analyticsDot.removeAttribute('aria-hidden');
          analyticsDot.setAttribute('role', 'img');
          analyticsDot.setAttribute('aria-label', 'Analytics review status: ' + atext);
        })
        .catch(function () { /* dot stays neutral */ });

      var adminLogoutBtn = document.createElement('button');
      adminLogoutBtn.textContent = 'Log out';
      adminLogoutBtn.className   = 'header-logout-btn';
      adminLogoutBtn.addEventListener('click', function () {
        sessionStorage.removeItem('elpys_admin_pw');
        location.href = '/';
      });
      adminGroup.appendChild(adminLogoutBtn);
      inner.appendChild(adminGroup);

      // ── Row 2: edit opportunities + submit link + digest button ─────────
      var sub = document.createElement('div');
      sub.className = 'header-admin-sub';

      var subEdit = document.createElement('a');
      subEdit.href        = '/admin-edit';
      subEdit.textContent = 'Edit opportunities';
      subEdit.className   = 'header-admin-link';
      sub.appendChild(subEdit);

      var subSubmit = document.createElement('a');
      subSubmit.href      = '/submit';
      subSubmit.textContent = 'Submit an opportunity';
      subSubmit.className   = 'header-admin-link';
      sub.appendChild(subSubmit);

      var digestMsg = document.createElement('span');
      digestMsg.className = 'header-digest-msg';

      var digestBtn = document.createElement('button');
      digestBtn.textContent = 'Send digest now';
      digestBtn.className   = 'header-logout-btn';
      digestBtn.addEventListener('click', function () {
        digestBtn.disabled    = true;
        digestBtn.textContent = 'Sending…';
        digestMsg.textContent = '';
        digestMsg.style.color = '#555';
        fetch('/api/send-digest', { headers: { 'x-admin-password': adminPw } })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (d) {
            if (!d.ok) throw new Error(d.j.error || 'HTTP error');
            digestMsg.textContent = d.j.message || ('Sent to ' + d.j.sent + ', skipped ' + d.j.skipped + '.');
            digestMsg.style.color = '#15803D';
          })
          .catch(function (err) {
            digestMsg.textContent = 'Error: ' + err.message;
            digestMsg.style.color = '#991B1B';
          })
          .then(function () {
            digestBtn.disabled    = false;
            digestBtn.textContent = 'Send digest now';
          });
      });
      sub.appendChild(digestBtn);
      sub.appendChild(digestMsg);
      inner.parentElement.appendChild(sub);
    }
    return;
  }

  // ── Normal user session (async Supabase check) ───────────────────────────
  if (!authEl) return;

  authEl.href        = '/login';
  authEl.textContent = 'Log in';

  var client = supabase.createClient(SUPA_URL, SUPA_ANON);
  client.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) return;

    authEl.href        = '/account';
    authEl.textContent = 'My account';

    var logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Log out';
    logoutBtn.className   = 'header-logout-btn';
    logoutBtn.addEventListener('click', function () {
      showModal({
        title:       'Log out?',
        body:        'You\'ll be signed out of your account.',
        confirmText: 'Log out',
        onConfirm:   function () {
          client.auth.signOut().then(function () {
            location.href = '/';
          });
        },
      });
    });
    authEl.insertAdjacentElement('afterend', logoutBtn);

    if (signupEl) signupEl.style.display = 'none';
  });
}());
