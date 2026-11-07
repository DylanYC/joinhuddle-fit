/* Risers launch switch — shared by every page.
 *
 * LAUNCH decides what the site offers:
 *   'waitlist'  the pre-launch site: waitlist forms and referral links.
 *   'ios-live'  App Store badge as the main call to action; Android visitors
 *               get a "notify me" form until Google Play is ready.
 *
 * To go live: change LAUNCH to 'ios-live' (APP_STORE_ID is already set).
 * Full launch-day steps: docs/launch-checklist.md in the app repo
 * (Risers Build Folder), "Launch day" → "The website".
 *
 * Preview without flipping: add ?launch=ios-live to any page URL, and
 * ?platform=ios|android|desktop to force a device version.
 *
 * Loaded as a plain (blocking) script in <head> so the <html> attributes are
 * set before first paint; assets/launch.css does the showing and hiding.
 */
(function () {
  var LAUNCH = 'waitlist';
  var APP_STORE_ID = '6798331472'; // Apple ID from App Store Connect → App Information

  var q = new URLSearchParams(location.search);
  var launchParam = q.get('launch');
  if (launchParam === 'waitlist' || launchParam === 'ios-live') LAUNCH = launchParam;

  var platform = q.get('platform');
  if (platform !== 'ios' && platform !== 'android' && platform !== 'desktop') {
    var ua = navigator.userAgent;
    // iPadOS Safari reports itself as a Mac; a touchscreen gives it away.
    var iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    platform = /iPhone|iPad|iPod/.test(ua) || iPadOS ? 'ios'
             : /Android/.test(ua) ? 'android'
             : 'desktop';
  }

  var root = document.documentElement;
  root.setAttribute('data-launch', LAUNCH);
  root.setAttribute('data-platform', platform);

  var appStoreUrl = APP_STORE_ID ? 'https://apps.apple.com/app/id' + APP_STORE_ID : '';

  // Safari's native "Open in App Store" bar at the top of the page.
  if (LAUNCH === 'ios-live' && APP_STORE_ID) {
    var meta = document.createElement('meta');
    meta.name = 'apple-itunes-app';
    meta.content = 'app-id=' + APP_STORE_ID;
    document.head.appendChild(meta);
  }

  // Point every App Store link at the listing once the page has parsed.
  document.addEventListener('DOMContentLoaded', function () {
    if (!appStoreUrl) return;
    document.querySelectorAll('[data-appstore]').forEach(function (a) { a.href = appStoreUrl; });
  });

  window.RISERS_LAUNCH = { state: LAUNCH, platform: platform, appStoreUrl: appStoreUrl };
})();
