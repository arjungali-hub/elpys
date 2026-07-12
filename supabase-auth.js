// Shared header auth updater — loaded on every public page after the Supabase SDK.
// Sets header buttons based on session state:
//   Logged out  → Log in + Sign up (static HTML, no change needed)
//   Normal user → My account + Log out
//   Admin       → Feedback + Edit opportunities + Approve opportunities

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
      if (!confirm('Log out of your account?')) return;
      client.auth.signOut().then(function () {
        location.href = base + 'index.html';
      });
    });
    authEl.insertAdjacentElement('afterend', logoutBtn);

    if (signupEl) signupEl.style.display = 'none';
  });
}());
