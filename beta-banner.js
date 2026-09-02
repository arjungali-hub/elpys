// Injects the dismissible notice banner below the header on every public page.
//
// Filename, ids and the sessionStorage key still say "beta" for historical
// reasons — this started life as a beta notice. It is not one any more: the
// Beta badge beside the wordmark is gone and the copy no longer describes the
// site as under test. The names are left alone deliberately, because renaming
// the storage key would un-dismiss the banner for everyone mid-session for no
// benefit, and the id is referenced from styles.css and the privacy policy's
// description of what it stores.
(function () {
  var DISMISSED_KEY = 'elpys-beta-banner-dismissed';

  function init() {
    // ── Dismissible notice banner below the header ───────────────────────────
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    // Extensionless: cleanUrls is on, so 'feedback.html' only worked via a
    // 308 redirect. One less hop, and it matches every other link on the site.
    var feedbackHref = '/feedback?from=' + encodeURIComponent(location.href);

    var banner = document.createElement('div');
    banner.id = 'beta-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Site notice');
    banner.innerHTML =
      'Elpys is new and still growing. Spot something wrong, or something missing? ' +
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
