// youtube.js - runs in YouTube's own page context (MAIN world) at document_start, in every frame
// on youtube.com, music.youtube.com, m.youtube.com and youtube-nocookie.com embeds.
// Registered by background.js so it can be switched off per site with "Pause".
//
// Three layers, from cleanest to last resort:
//   1. Strip the ad schedule out of player data before the player reads it, so no ad is ever
//      requested. YouTube delivers it in ytInitialPlayerResponse (first page load) and in the
//      JSON of /youtubei/v1/player and /next (every later video, the site is a single page app).
//   2. If an ad still starts (YouTube changes its formats often), mute it, jump to its end and
//      press "Skip".
//   3. Page ads (feed, sidebar, banners) are hidden by CSS from tools/custom-filters.txt and
//      EasyList, injected by background.js.
(() => {
  if (window.__PAB_YT__) return;
  window.__PAB_YT__ = true;

  // ---- 1. Remove ad data from player responses ---------------------------------------------
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];

  const pruneOne = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of AD_KEYS) if (k in o) delete o[k];
  };
  const prune = (o) => {
    if (!o || typeof o !== 'object') return o;
    try {
      pruneOne(o);
      if (o.playerResponse) pruneOne(o.playerResponse);
      if (o.response?.playerResponse) pruneOne(o.response.playerResponse);
      if (Array.isArray(o)) for (const item of o) if (item?.playerResponse) pruneOne(item.playerResponse);
    } catch {}
    return o;
  };

  // JSON.parse: wrapped with a Proxy so it keeps its name, length and toString.
  JSON.parse = new Proxy(JSON.parse, {
    apply(target, thisArg, args) { return prune(Reflect.apply(target, thisArg, args)); },
  });

  // fetch(...).then(r => r.json())
  const resJson = Response.prototype.json;
  Response.prototype.json = new Proxy(resJson, {
    apply(target, thisArg, args) { return Reflect.apply(target, thisArg, args).then(prune); },
  });

  // Data embedded in the first page load: `var ytInitialPlayerResponse = {...}`
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (v) => { value = prune(v); },
      });
    } catch {}
  }

  // ---- 2. Fallback: skip any ad that still plays -------------------------------------------
  const SKIP_BUTTONS = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button';
  let mutedByUs = false;

  const handleAd = () => {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!player) return;
    const video = player.querySelector('video');
    if (player.classList.contains('ad-showing')) {
      if (video) {
        if (!video.muted) { video.muted = true; mutedByUs = true; }
        if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
          video.currentTime = video.duration;
        }
      }
      player.querySelector(SKIP_BUTTONS)?.click();
    } else if (mutedByUs && video) {
      video.muted = false;
      mutedByUs = false;
    }
  };

  // A cheap check four times a second; only while the tab is visible.
  setInterval(() => { if (!document.hidden) handleAd(); }, 250);
})();
