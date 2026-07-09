// Injects the beta banner and site-name badge on every public page.
// Remove this script tag (and the styles in styles.css) once the site launches.
(function () {
  var DISMISSED_KEY = 'elpys-beta-banner-dismissed';

  function init() {
    // ── Beta badge next to "Elpys" in the header ────────────────────────────
    var siteName = document.querySelector('.site-name');
    if (siteName && !siteName.querySelector('.beta-badge')) {
      var badge = document.createElement('span');
      badge.className = 'beta-badge';
      badge.textContent = 'Beta';
      siteName.appendChild(badge);
    }

    // ── Dismissible beta banner below the header ─────────────────────────────
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    var isSubdir = location.pathname.indexOf('/opportunities/') !== -1;
    var feedbackHref = (isSubdir ? '../' : '') + 'feedback.html?from=' + encodeURIComponent(location.href);

    var banner = document.createElement('div');
    banner.id = 'beta-banner';
    banner.innerHTML =
      'Elpys is in beta — some features are still being tested. Found something broken? ' +
      '<a href="' + feedbackHref + '">Let us know</a>.' +
      '<button id="beta-banner-close" aria-label="Dismiss">×</button>';

    var header = document.querySelector('header');
    if (header) header.insertAdjacentElement('afterend', banner);

    document.getElementById('beta-banner-close').addEventListener('click', function () {
      sessionStorage.setItem(DISMISSED_KEY, '1');
      banner.style.transition = 'opacity 0.2s';
      banner.style.opacity = '0';
      setTimeout(function () { banner.remove(); }, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
