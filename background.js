importScripts('sites.js', 'default-ad-domains.js');

// =============================================================================================
// Popup & Ad Blocker Pro - background service worker
//
//  * Network blocking   static rulesets (EasyList, EasyPrivacy, custom) + a dynamic ad-domain
//                       list that can be refreshed from Peter Lowe's list
//  * Cosmetic filtering element-hiding CSS injected into every frame on every site
//  * YouTube            a page script that strips ads from the player (registered dynamically)
//  * Pop-up protection  stricter rules for the sites in sites.js + sites added in the popup
//  * Pause              per-site switch that turns all of the above off for that site
// =============================================================================================

const isSafari = typeof location !== 'undefined' && location.protocol === 'safari-web-extension:';

// Dynamic rule id ranges
const PATTERN_RULE_START = 1;        // 1..99     URL patterns for protected sites (Safari)
const PAUSE_RULE_ID = 900;           // 900       allow-everything rule for paused sites
const AD_RULE_START = 10001;         // 10001..   refreshed ad-domain list

const STATIC_RULESETS = ['easylist', 'easyprivacy', 'custom'];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const validDomain = (d) => DOMAIN_RE.test(d);

const hostOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : null;
  } catch { return null; }
};

const matchesList = (host, list) => {
  if (!host) return false;
  const h = host.replace(/^www\./, '');
  return list.some((s) => h === s || h.endsWith('.' + s));
};

const getLocal = (defaults) => chrome.storage.local.get(defaults);

const allSites = () => getLocal({ extraSites: [] }).then((r) => {
  const builtin = Array.isArray(self.BLOCK_SITES) ? self.BLOCK_SITES : [];
  return [...new Set(builtin.concat(r.extraSites || []))];
});

const getPaused = () => getLocal({ pausedSites: [] }).then((r) => r.pausedSites || []);

// ---------------------------------------------------------------------------------------------
// URL patterns for rotating ad networks (applied only on protected sites)
// ---------------------------------------------------------------------------------------------

const HOST12 = '[a-z0-9]'.repeat(12) + '[a-z0-9]*';
const HEX16 = '[0-9a-f]'.repeat(16);
const PATTERNS = [
  { urlFilter: '/cuid/?f=http' },
  { regexFilter: '/gd/[0-9]+\\?md=' },
  { regexFilter: '/sbx/[fb]/' },
  { regexFilter: '^https?://[a-z0-9.-]+\\.cfd/[a-z][a-z]?/' },
  { regexFilter: '^https?://[a-z0-9.-]+\\.cyou/[a-z][a-z]?/' },
  { regexFilter: '^https?://[a-z0-9.-]+\\.qpon/[a-z][a-z]?/' },
  { regexFilter: '^https?://[a-z][a-z]\\.[a-z]+\\.com/[A-Za-z0-9]+/[0-9][0-9][0-9][0-9][0-9][0-9]$', resourceTypes: ['script'] },
  { regexFilter: `^https?://${HOST12}\\.${HOST12}\\.[a-z]+/`, resourceTypes: ['script'] },
  { urlFilter: 'workers.dev/fetch?url=', resourceTypes: ['script'] },
  { regexFilter: `/${HEX16}[0-9a-f]*/invoke\\.js`, resourceTypes: ['script'] },
  { regexFilter: '/watch\\.[0-9]+\\.js\\?key=' },
  { regexFilter: `^https?://[^/]+/[0-9][0-9]?/${HEX16}` },
  { urlFilter: '/script/suurl5.php?' },
  { urlFilter: '/script/i.php?' },
  { urlFilter: '/script/iprp.php?' },
  { urlFilter: '/jump/next.php?' },
  { regexFilter: '/delivery/impress\\.[a-z0-9]+\\.js' },
  { regexFilter: '/popunders?/[0-9]+\\.js' },
  { regexFilter: '/ad_click\\.php\\?' },
  { regexFilter: '/tag/v[0-9]+/tag\\.js' },
];

const makePatternRule = (c, i, scope) => ({
  id: PATTERN_RULE_START + i,
  priority: 100,
  action: { type: 'block' },
  condition: { ...c, ...scope, domainType: 'thirdParty', isUrlFilterCaseSensitive: true },
});

// ---------------------------------------------------------------------------------------------
// Refreshable ad-domain list (Peter Lowe + built-in database)
// ---------------------------------------------------------------------------------------------

const REMOTE_AD_FEED = 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext';
const DOMAINS_PER_RULE = 1000;

const fetchAdDomains = async () => {
  const fallback = Array.isArray(self.DEFAULT_AD_DOMAINS) ? self.DEFAULT_AD_DOMAINS : [];
  try {
    const res = await fetch(REMOTE_AD_FEED, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fetched = (await res.text()).split('\n').map((l) => l.trim().toLowerCase());
    // Audit fix: one malformed line used to make Chrome reject the whole update.
    const domains = [...new Set([...fetched, ...fallback])].filter(validDomain).sort();
    return { domains, source: 'Peter Lowe live list + built-in database' };
  } catch (err) {
    console.warn('Ad list download failed, using built-in database:', err);
    return { domains: fallback.filter(validDomain), source: 'Built-in database (offline)' };
  }
};

const applyDynamicAdRules = async (domains, source) => {
  const addRules = [];
  for (let i = 0; i < domains.length; i += DOMAINS_PER_RULE) {
    addRules.push({
      id: AD_RULE_START + addRules.length,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: domains.slice(i, i + DOMAINS_PER_RULE), domainType: 'thirdParty' },
    });
  }
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.filter((r) => r.id >= AD_RULE_START).map((r) => r.id),
    addRules,
  });
  const lastUpdated = new Date().toISOString();
  await chrome.storage.local.set({ lastUpdated, adDomainsCount: domains.length, updateSource: source });
  return { success: true, count: domains.length, lastUpdated, source };
};

const updateAdLists = async () => {
  const { domains, source } = await fetchAdDomains();
  return applyDynamicAdRules(domains, source);
};

// Audit fix: alarms.create() at top level restarted the 24h timer every time the worker woke up,
// so the daily update never fired. Only create it when it doesn't exist.
const ensureAlarm = async () => {
  if (!(await chrome.alarms.get('checkAdListUpdate'))) {
    await chrome.alarms.create('checkAdListUpdate', { periodInMinutes: 1440, delayInMinutes: 1440 });
  }
};
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'checkAdListUpdate') updateAdLists().catch(console.error);
});

// ---------------------------------------------------------------------------------------------
// Pause per site + dynamically registered page scripts
// ---------------------------------------------------------------------------------------------

const toMatches = (domains) => domains.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);

const YT_MATCHES = ['*://*.youtube.com/*', '*://youtube.com/*', '*://*.youtube-nocookie.com/*'];

// Calls are queued: two overlapping unregister/register sequences would fail with
// "duplicate script id" and leave a script unregistered.
let scriptQueue = Promise.resolve();
const syncPageScripts = () => (scriptQueue = scriptQueue.then(doSyncPageScripts, doSyncPageScripts));
const doSyncPageScripts = async () => {
  const [paused, extra] = await Promise.all([getPaused(), getLocal({ extraSites: [] }).then((r) => r.extraSites || [])]);
  const wanted = [{
    id: 'pab-youtube',
    js: ['youtube.js'],
    matches: YT_MATCHES,
    excludeMatches: toMatches(paused),
    runAt: 'document_start',
    allFrames: true,
    world: 'MAIN',
  }];
  // Audit fix: sites added from the popup used to be protected only after an async storage read,
  // so page scripts could grab window.open first. Registering them as real content scripts makes
  // protection start at document_start like the built-in sites.
  if (extra.length) {
    wanted.push({
      id: 'pab-extras',
      js: ['force-flag.js'],
      matches: toMatches(extra),
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN',
    });
  }
  try {
    const current = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
    if (current.length) await chrome.scripting.unregisterContentScripts({ ids: current });
    await chrome.scripting.registerContentScripts(wanted);
  } catch (err) {
    console.error('Script registration failed:', err);
  }
};

const syncPauseRule = async () => {
  const paused = await getPaused();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PAUSE_RULE_ID],
    addRules: paused.length ? [{
      id: PAUSE_RULE_ID,
      priority: 1000000, // above every block rule in every ruleset
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: paused, resourceTypes: ['main_frame', 'sub_frame'] },
    }] : [],
  });
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.pausedSites) { syncPauseRule().catch(console.error); syncPageScripts(); cssCache.clear(); }
  if (changes.extraSites) { syncPageScripts(); if (isSafari) syncSafariPatterns(); }
});

// ---------------------------------------------------------------------------------------------
// Cosmetic filtering (element hiding) on every site
// ---------------------------------------------------------------------------------------------

let cosmeticPromise = null;
const loadCosmetic = () => (cosmeticPromise ||= fetch(chrome.runtime.getURL('filters/cosmetic.json'))
  .then((r) => r.json())
  .catch((e) => { console.error('cosmetic.json failed to load', e); return { generic: [], hide: {}, unhide: {}, genericHide: [] }; }));

// "a.b.example.co.uk" -> ["a.b.example.co.uk", "b.example.co.uk", "example.co.uk", "co.uk"]
// plus "example.*"-style entity names used by EasyList.
const hostKeys = (host) => {
  const parts = host.split('.');
  const keys = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join('.');
    keys.push(suffix);
    keys.push(parts.slice(i, -1).join('.') + '.*');
    if (parts.length - i > 2) keys.push(parts.slice(i, -2).join('.') + '.*');
  }
  return keys;
};

// Plain selector lists, NOT :is(...): Chrome indexes each selector in a list by its last
// class/id/tag, so only a handful are tested per element. Wrapping them in :is() defeats that
// index and made every element test all ~14,000 selectors (page loads went from 0.3s to 3.2s).
// Every selector has already been parsed by real Chromium at build time (tests/check-rules.mjs),
// so one bad selector can't silently drop a whole chunk.
const CHUNK = 1000;
const toCss = (selectors) => {
  let css = '';
  for (let i = 0; i < selectors.length; i += CHUNK) {
    css += `${selectors.slice(i, i + CHUNK).join(',\n')}{display:none!important}\n`;
  }
  return css;
};

const cssCache = new Map();
const cssFor = async (host) => {
  if (cssCache.has(host)) return cssCache.get(host);
  const data = await loadCosmetic();
  const keys = hostKeys(host);
  const unhide = new Set(keys.flatMap((k) => data.unhide[k] || []));
  const noGeneric = keys.some((k) => data.genericHide.includes(k));
  const specific = keys.flatMap((k) => data.hide[k] || []).filter((s) => !unhide.has(s));
  const generic = noGeneric ? [] : (unhide.size ? data.generic.filter((s) => !unhide.has(s)) : data.generic);
  const css = toCss([...new Set([...specific, ...generic])]);
  if (cssCache.size > 300) cssCache.delete(cssCache.keys().next().value);
  cssCache.set(host, css);
  return css;
};

const injectCosmetic = async ({ tabId, frameId, url }) => {
  const host = hostOf(url);
  if (!host || tabId < 0) return;
  const paused = await getPaused();
  if (matchesList(host, paused)) return;
  // Frames inside a paused site (embedded players, widgets) are left alone too
  if (frameId !== 0 && paused.length) {
    const top = await chrome.tabs.get(tabId).then((t) => hostOf(t.url || t.pendingUrl || '')).catch(() => null);
    if (matchesList(top, paused)) return;
  }
  const css = await cssFor(host);
  if (!css) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css, origin: 'USER' });
  } catch { /* frame gone, or a page we can't touch (web store, chrome://) */ }
};

chrome.webNavigation.onCommitted.addListener(injectCosmetic);

// ---------------------------------------------------------------------------------------------
// Protected-site URL patterns: Chromium scopes them to tabs, Safari to initiator domains
// ---------------------------------------------------------------------------------------------

const syncSafariPatterns = () => allSites().then((sites) =>
  chrome.declarativeNetRequest.getDynamicRules().then((old) => chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.filter((r) => r.id < PAUSE_RULE_ID).map((r) => r.id),
    addRules: sites.length ? PATTERNS.map((c, i) => makePatternRule(c, i, { initiatorDomains: sites })) : [],
  }))).catch(console.error);

if (isSafari) {
  syncSafariPatterns();
} else {
  let queue = Promise.resolve();
  const setTab = (tabId, on) => (queue = queue.then(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const tabs = new Set(rules[0]?.condition.tabIds || []);
    if (tabs.has(tabId) === on) return;
    on ? tabs.add(tabId) : tabs.delete(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: tabs.size ? PATTERNS.map((c, i) => makePatternRule(c, i, { tabIds: [...tabs] })) : [],
    });
  }).catch(console.error));

  chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
    if (d.frameId === 0) setTab(d.tabId, matchesList(hostOf(d.url), await allSites()));
  });
  chrome.tabs.onRemoved.addListener((tabId) => setTab(tabId, false));
}

// ---------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------

// Audit fix: each event used to do its own read-modify-write, so bursts lost counts. Events are
// now added up in memory and written once a second.
let pendingStats = { popup: 0, link: 0, element: 0 };
let statsTimer = null;
const flushStats = async () => {
  statsTimer = null;
  const add = pendingStats;
  pendingStats = { popup: 0, link: 0, element: 0 };
  const { stats: s } = await getLocal({ stats: { popupsBlocked: 0, linksDefused: 0, elementsHidden: 0, totalBlocked: 0 } });
  s.popupsBlocked += add.popup;
  s.linksDefused += add.link;
  s.elementsHidden += add.element;
  s.totalBlocked += add.popup + add.link + add.element;
  await chrome.storage.local.set({ stats: s });
};
const recordBlockedAction = (type) => {
  if (!(type in pendingStats)) return;
  pendingStats[type]++;
  statsTimer ||= setTimeout(flushStats, 1000);
};

// The toolbar badge shows how many requests were blocked on the current tab (counted by Chrome).
try { chrome.declarativeNetRequest.setExtensionActionOptions?.({ displayActionCountAsBadgeText: true }); } catch {}

// ---------------------------------------------------------------------------------------------
// Messages from the popup and content scripts
// ---------------------------------------------------------------------------------------------

const getState = async () => {
  const [enabled, meta, local] = await Promise.all([
    chrome.declarativeNetRequest.getEnabledRulesets(),
    fetch(chrome.runtime.getURL('filters/meta.json')).then((r) => r.json()).catch(() => ({})),
    getLocal(['stats', 'lastUpdated', 'adDomainsCount', 'updateSource', 'pausedSites']),
  ]);
  return { enabledRulesets: enabled, meta, ...local };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'checkAndUpdateLists':
      updateAdLists().then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    case 'recordBlock':
      recordBlockedAction(message.type);
      return false;
    case 'getState':
      getState().then(sendResponse);
      return true;
    case 'setRuleset': {
      if (!STATIC_RULESETS.includes(message.id)) return false;
      const opts = message.enabled ? { enableRulesetIds: [message.id] } : { disableRulesetIds: [message.id] };
      chrome.declarativeNetRequest.updateEnabledRulesets(opts)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    case 'getQuickStats':
      getLocal(['stats', 'lastUpdated', 'adDomainsCount', 'updateSource']).then(sendResponse);
      return true;
  }
  return false;
});

// ---------------------------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await getLocal(['lastUpdated']);
  if (!stored.lastUpdated) {
    const initial = (Array.isArray(self.DEFAULT_AD_DOMAINS) ? self.DEFAULT_AD_DOMAINS : []).filter(validDomain);
    await applyDynamicAdRules(initial, 'Built-in database').catch(console.error);
  }
  await Promise.all([ensureAlarm(), syncPauseRule(), syncPageScripts()]).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm().catch(console.error);
  syncPageScripts();
});
