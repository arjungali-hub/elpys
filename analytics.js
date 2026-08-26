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
//   - person_profiles: 'identified_only': since this site never calls
//     posthog.identify(...), no identified person profiles are created at
//     all — everything stays anonymous, aggregate counts.
//
// NOTE: PostHog's hosts also have to be allowed by the Content-Security-Policy
// in vercel.json (script-src for the loader, connect-src for the events).
// They are already listed there; if POSTHOG_HOST changes region, update both.

// Project API key — public by design, meant to ship in client-side code.
// Region confirmed as US cloud: this key resolves at us.i.posthog.com and
// 404s at eu.i.posthog.com, so POSTHOG_HOST below is correct as-is.
var POSTHOG_KEY  = 'phc_Djsocccc9gViK57QBT7abSeZptD5ubtdTrXURLQGbHRg';
var POSTHOG_HOST = 'https://us.i.posthog.com';

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
  defaults: '2026-05-30',
  autocapture: false,
  disable_session_recording: true,
  cookieless_mode: 'always',
  person_profiles: 'identified_only',
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
