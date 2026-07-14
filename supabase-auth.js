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

  function close() { overlay.remove(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('.modal-btn-cancel').addEventListener('click', close);
  overlay.querySelector('.modal-btn-action').addEventListener('click', function () {
    close();
    opts.onConfirm();
  });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

(function () {
  var SUPA_URL  = 'https://ukrykzmehvghedrvmkjj.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcnlrem1laHZnaGVkcnZta2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODc4NzgsImV4cCI6MjA5ODk2Mzg3OH0.J1J4p3lTbQKMc3GvWVlBxAZZV1jGYPIU4Jj_ePLndgM';

  var isSubdir = location.pathname.indexOf('/opportunities/') !== -1;
  var base     = isSubdir ? '../' : '';

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
      var adminGroup = document.createElement('div');
      adminGroup.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-left:auto;';

      function makeAdminLink(text, href) {
        var a = document.createElement('a');
        a.href        = href;
        a.textContent = text;
        a.className   = 'header-admin-link';
        return a;
      }

      adminGroup.appendChild(makeAdminLink('Feedback',              base + 'admin.html?view=feedback'));
      adminGroup.appendChild(makeAdminLink('Edit opportunities',    base + 'admin.html?view=edit'));
      adminGroup.appendChild(makeAdminLink('Approve opportunities', base + 'admin.html?view=confirm'));

      var adminLogoutBtn = document.createElement('button');
      adminLogoutBtn.textContent = 'Log out';
      adminLogoutBtn.className   = 'header-logout-btn';
      adminLogoutBtn.addEventListener('click', function () {
        sessionStorage.removeItem('elpys_admin_pw');
        location.href = base + 'index.html';
      });
      adminGroup.appendChild(adminLogoutBtn);

      inner.appendChild(adminGroup);
    }
    return;
  }

  // ── Normal user session (async Supabase check) ───────────────────────────
  if (!authEl) return;

  authEl.href        = base + 'login.html';
  authEl.textContent = 'Log in';

  var client = supabase.createClient(SUPA_URL, SUPA_ANON);
  client.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (!session) return;

    authEl.href        = base + 'account.html';
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
            location.href = base + 'index.html';
          });
        },
      });
    });
    authEl.insertAdjacentElement('afterend', logoutBtn);

    if (signupEl) signupEl.style.display = 'none';
  });
}());
