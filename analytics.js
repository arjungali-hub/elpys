// PostHog analytics — privacy-hardened for a teen-facing site.
//
// Deliberately configured to collect the minimum useful signal:
//   - autocapture off: no blanket click/interaction tracking. Only page
//     views (automatic) and the explicit posthog.capture(...) calls added
//     at specific points in the site (see below) are recorded.
//   - session recording off entirely: never records what anyone typed or
//     how they moved on the page.
//   - cookieless_mode: no cookies or persistent identifiers are set for
//     analytics. Nothing here ties a pageview/event to a specific visitor
//     across sessions.
//   - person_profiles: 'never': this site never calls posthog.identify(...),
//     and cookieless_mode makes that a hard rule, not just current practice —
//     a persistent distinct ID is Personal Data under GDPR and would undo the
//     point of cookieless tracking. 'never' turns identify() into a no-op if
//     one is ever added by accident, rather than quietly creating a profile.
//
// NOTE: PostHog's hosts also have to be allowed by the Content-Security-Policy
// in vercel.json (script-src for the loader, connect-src for the events).
// They are already listed there; if POSTHOG_HOST changes region, update both.

var POSTHOG_KEY  = 'phc_Djsocccc9gViK57QBT7abSeZptD5ubtdTrXURLQGbHRg';

// NOTE ON REVERSE PROXY: PostHog traffic is routed through this site's own
// /lantern path (see the vercel.json "rewrites" block), not directly to
// posthog.com. This is deliberate: ad blockers maintain blocklists of known
// analytics domains, and routing through our own origin avoids them,
// meaningfully improving how much real usage we can see. Because of this,
// the PostHog domains no longer need to be (and have been removed from) the
// Content-Security-Policy in vercel.json — the loader script and event/config
// requests are now same-origin. If POSTHOG_HOST is ever pointed back at
// PostHog's domains directly (e.g. proxy removed), the CSP entries for
// us.i.posthog.com and us-assets.i.posthog.com will need to be restored.
var POSTHOG_HOST = '/lantern';

// While the key is still the placeholder, load nothing. Initialising with it
// would fetch the loader script and fire an event request on every page view,
// both of which can only fail — a console error for every visitor, on every
// page, for no signal. Swapping in the real key is all it takes to switch on.
if (POSTHOG_KEY.charAt(0) === '<') {
  console.info('[analytics] PostHog project key not set yet — analytics is disabled.');
} else {

!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

posthog.init(POSTHOG_KEY, {
  api_host: POSTHOG_HOST,
  ui_host: 'https://us.posthog.com',
  defaults: '2026-05-30',
  autocapture: false,
  disable_session_recording: true,
  cookieless_mode: 'always',
  person_profiles: 'never',

  // disable_compression: request_batching's gzip path (posthog-js's own
  // fflate-based gzip, not a browser Content-Encoding) was silently losing
  // every custom event sent through it. Confirmed directly against
  // production with CDP: a feedback_submitted/signup_link_clicked capture()
  // call produces an ArrayBuffer body starting with the gzip magic bytes
  // (1f 8b 08...), but neither the request headers nor the URL carry any
  // compression signal (no Content-Encoding, no ?compression=gzip-js) —
  // checked at the wire level via Network.requestWillBeSentExtraInfo, so
  // this is what the browser actually sent, not something Vercel's rewrite
  // stripped. PostHog's ingestion endpoint ACKs 200 "Ok" regardless (it
  // queues for async processing), so the failure was invisible client-side.
  // The automatic $pageview send goes out the same way (also unsignaled
  // gzip) but reaches PostHog anyway — it uses the older, unbatched /e/
  // endpoint, which appears to sniff gzip by magic bytes; the batched
  // /i/v0/e/ endpoint that custom events go through does not, and silently
  // drops what it can't parse. Disabling compression sends plain JSON
  // instead (posthog-js's own fallback path when this flag is set), which
  // sidesteps the missing signal entirely rather than trying to reproduce
  // whatever signal the SDK isn't attaching correctly in this setup.
  disable_compression: true,

  // The five below are NOT covered by autocapture: false. A dated `defaults`
  // value turns dead-click and rageclick capture on by itself, and heatmaps,
  // exception capture and performance capture fall back to whatever is toggled
  // in the PostHog project UI — i.e. they can be switched on remotely, without
  // a code change, which is exactly what a privacy policy must not depend on.
  // Pinning them here keeps privacy.html section 5 ("no blanket click
  // tracking", "no session or screen recording") true no matter what the
  // project settings say. Dead clicks and rageclicks each record the element
  // that was clicked and where on the page it was — click tracking by another
  // name, and not something a teen-facing directory needs.
  //
  // capture_performance is deliberately left at its default (web vitals on):
  // it is pure page-speed telemetry, it is disclosed in privacy.html section 5,
  // and it is the site's only production performance signal. It was briefly
  // pinned to false on 2026-08-25, when the then-current policy did not mention
  // it; the rewritten policy does, so the disclosure now carries it instead.
  capture_dead_clicks: false,
  rageclick:           false,
  capture_heatmaps:    false,
  enable_heatmaps:     false,   // older alias, set too in case the loaded SDK predates the rename
  capture_exceptions:  false,
});

// One explicit, site-wide custom event: a click on an opportunity's primary
// "Sign up" button (index.html cards and the opportunities-detail.html
// detail box both wrap it in .card-actions; "More info"/back links use
// .btn-ghost and are deliberately excluded). Event delegation on <body>
// means this is a no-op (never fires) on pages with no such button —
// safe to load everywhere. autocapture is off, so without this listener
// the only signal would be raw page views.
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('.card-actions .btn:not(.btn-ghost)');
  if (btn && window.posthog) posthog.capture('signup_link_clicked');
});

}
