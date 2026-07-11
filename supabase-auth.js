// Shared auth header updater — loaded on every public page.
// Requires @supabase/supabase-js v2 to be loaded first (via CDN script tag).
// Updates #header-auth-link to reflect whether the visitor is signed in.

(function () {
  var SUPA_URL  = 'https://ukrykzmehvghedrvmkjj.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcnlrem1laHZnaGVkcnZta2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODc4NzgsImV4cCI6MjA5ODk2Mzg3OH0.J1J4p3lTbQKMc3GvWVlBxAZZV1jGYPIU4Jj_ePLndgM';

  var el = document.getElementById('header-auth-link');
  if (!el) return;

  var isSubdir = location.pathname.indexOf('/opportunities/') !== -1;
  var base     = isSubdir ? '../' : '';

  // Default (visible immediately before async check completes)
  el.href        = base + 'login.html';
  el.textContent = 'Log in';

  var client = supabase.createClient(SUPA_URL, SUPA_ANON);
  client.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (session) {
      el.href        = base + 'account.html';
      el.textContent = 'My account';
      var signupEl = document.getElementById('header-signup-link');
      if (signupEl) signupEl.style.display = 'none';
    }
  });
}());
