importScripts('sites.js', 'default-ad-domains.js');

// URL pattern rules for ad networks whose domains rotate constantly.
// Scoped conditionally so they only apply to tabs browsing protected sites.
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
  { regexFilter: '/tag/v[0-9]+/tag\\.js' }
];

const makePatternRule = (c, i, scope) => ({
  id: i + 1,
  action: { type: 'block' },
  condition: { ...c, ...scope, domainType: 'thirdParty', isUrlFilterCaseSensitive: true },
});

// Built-in sites (minus any the user removed) + user-added sites
const allSites = () => chrome.storage.local.get({ extraSites: [], removedSites: [] }).then(r => {
  const builtin = (Array.isArray(self.BLOCK_SITES) ? self.BLOCK_SITES : []).filter(s => !r.removedSites.includes(s));
  return Array.from(new Set(builtin.concat(r.extraSites || [])));
});

// Page scripts are registered here instead of in manifest.json so their order is controlled:
// off-flag.js (removed sites only) must run right before nopopup.js. Chrome runs registered
// scripts in alphabetical order of their ids, hence the 1-/2- prefixes.
let scriptQueue = Promise.resolve();
const syncPageScripts = () => (scriptQueue = scriptQueue.then(async () => {
  const { removedSites = [] } = await chrome.storage.local.get({ removedSites: [] });
  const wanted = [];
  if (removedSites.length) {
    wanted.push({
      id: 'pab-1-off',
      js: ['off-flag.js'],
      matches: removedSites.flatMap(d => [`*://${d}/*`, `*://*.${d}/*`]),
      runAt: 'document_start', allFrames: true, world: 'MAIN',
    });
  }
  wanted.push({
    id: 'pab-2-main',
    js: ['sites.js', 'nopopup.js'],
    matches: ['<all_urls>'],
    runAt: 'document_start', allFrames: true, world: 'MAIN', matchOriginAsFallback: true,
  });
  const current = (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id);
  if (current.length) await chrome.scripting.unregisterContentScripts({ ids: current });
  await chrome.scripting.registerContentScripts(wanted);
}).catch(console.error));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.removedSites) syncPageScripts();
});
chrome.runtime.onStartup.addListener(() => syncPageScripts());

// Update feed configuration
const REMOTE_AD_FEED = 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext';
const DYNAMIC_RULE_START_ID = 10001;
const DOMAINS_PER_RULE = 800;

// Fetch and compile ad domains from remote list with offline fallback
const fetchAdDomains = async () => {
  let domains = [];
  let source = '';
  try {
    const res = await fetch(REMOTE_AD_FEED, { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      const fetched = text.split('\n')
        .map(l => l.trim().toLowerCase())
        .filter(l => l && !l.startsWith('#') && !l.includes('*') && !l.includes('/'));
      
      const fallback = Array.isArray(self.DEFAULT_AD_DOMAINS) ? self.DEFAULT_AD_DOMAINS : [];
      domains = Array.from(new Set([...fetched, ...fallback])).sort();
      source = 'Peter Lowe Live Adservers + Pro Database';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn('Network update failed, using built-in database:', err);
    domains = Array.isArray(self.DEFAULT_AD_DOMAINS) ? [...self.DEFAULT_AD_DOMAINS] : [];
    source = 'Built-in Pro Database (Offline)';
  }
  return { domains, source };
};

// Applies ad domains as dynamic DNR rules in chunks
const applyDynamicAdRules = async (domains, source) => {
  try {
    const chunks = [];
    for (let i = 0; i < domains.length; i += DOMAINS_PER_RULE) {
      chunks.push(domains.slice(i, i + DOMAINS_PER_RULE));
    }

    const newRules = chunks.map((chunk, idx) => ({
      id: DYNAMIC_RULE_START_ID + idx,
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: chunk,
        domainType: 'thirdParty',
        resourceTypes: [
          'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
          'font', 'object', 'xmlhttprequest', 'ping', 'media',
          'websocket', 'webtransport', 'other'
        ]
      }
    }));

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldAdRuleIds = existingRules
      .filter(r => r.id >= DYNAMIC_RULE_START_ID)
      .map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldAdRuleIds,
      addRules: newRules
    });

    const now = new Date().toISOString();
    await chrome.storage.local.set({
      lastUpdated: now,
      adDomainsCount: domains.length,
      updateSource: source || 'Updated Lists',
      rulesActiveCount: newRules.length
    });

    return { success: true, count: domains.length, lastUpdated: now, source };
  } catch (err) {
    console.error('Failed to apply dynamic ad rules:', err);
    throw err;
  }
};

// Full update pipeline called manually or via daily alarm
const updateAdLists = async () => {
  const { domains, source } = await fetchAdDomains();
  return await applyDynamicAdRules(domains, source);
};

// Periodic daily auto-check
try {
  chrome.alarms.create('checkAdListUpdate', { periodInMinutes: 1440 });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'checkAdListUpdate') {
      updateAdLists().catch(console.error);
    }
  });
} catch {}

// Safari vs Chromium Tab/Domain Handling
const isSafari = typeof location !== 'undefined' && location.protocol === 'safari-web-extension:';

if (isSafari) {
  const syncSafari = () => allSites().then(sites =>
    chrome.declarativeNetRequest.getDynamicRules().then(old => {
      const patternRuleIds = old.filter(r => r.id < DYNAMIC_RULE_START_ID).map(r => r.id);
      return chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: patternRuleIds,
        addRules: sites.length ? PATTERNS.map((c, i) => makePatternRule(c, i, { domains: sites })) : [],
      });
    })
  ).catch(console.error);

  syncSafari();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.extraSites || changes.removedSites)) syncSafari();
  });
} else {
  const onSite = async url => {
    try {
      const h = new URL(url).hostname;
      const sites = await allSites();
      return sites.some(s => h === s || h.endsWith('.' + s));
    } catch {
      return false;
    }
  };

  let queue = Promise.resolve();
  const setTab = (tabId, on) => (queue = queue.then(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const tabs = new Set(rules[0]?.condition.tabIds || []);
    if (tabs.has(tabId) === on) return;
    on ? tabs.add(tabId) : tabs.delete(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.map(r => r.id),
      addRules: tabs.size ? PATTERNS.map((c, i) => makePatternRule(c, i, { tabIds: [...tabs] })) : [],
    });
  }).catch(console.error));

  chrome.webNavigation.onBeforeNavigate.addListener(async d => {
    if (d.frameId === 0) setTab(d.tabId, await onSite(d.url));
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    setTab(tabId, false);
    delete tabBlockCounts[tabId];
  });
}

// Track blocked actions and badge counter per tab
const tabBlockCounts = {};

const recordBlockedAction = async (tabId, type) => {
  if (tabId && tabId > 0) {
    tabBlockCounts[tabId] = (tabBlockCounts[tabId] || 0) + 1;
    try {
      await chrome.action.setBadgeText({ tabId, text: String(tabBlockCounts[tabId]) });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e53935' });
    } catch {}
  }

  // Update cumulative statistics in storage
  try {
    const data = await chrome.storage.local.get({
      stats: { popupsBlocked: 0, linksDefused: 0, elementsHidden: 0, totalBlocked: 0 }
    });
    const s = data.stats;
    if (type === 'popup') s.popupsBlocked = (s.popupsBlocked || 0) + 1;
    else if (type === 'link') s.linksDefused = (s.linksDefused || 0) + 1;
    else if (type === 'element') s.elementsHidden = (s.elementsHidden || 0) + 1;
    s.totalBlocked = (s.totalBlocked || 0) + 1;
    await chrome.storage.local.set({ stats: s });
  } catch {}
};

// Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkAndUpdateLists') {
    updateAdLists()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.action === 'recordBlock') {
    const tabId = sender.tab ? sender.tab.id : null;
    recordBlockedAction(tabId, message.type);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'getQuickStats') {
    chrome.storage.local.get(['stats', 'lastUpdated', 'adDomainsCount', 'updateSource'], r => {
      sendResponse(r);
    });
    return true;
  }
});

// Initialization on install/startup
chrome.runtime.onInstalled.addListener(async () => {
  syncPageScripts();
  const stored = await chrome.storage.local.get(['lastUpdated', 'adDomainsCount']);
  if (!stored.lastUpdated) {
    // Seed initial ad rules immediately from built-in offline database
    const initialDomains = Array.isArray(self.DEFAULT_AD_DOMAINS) ? self.DEFAULT_AD_DOMAINS : [];
    await applyDynamicAdRules(initialDomains, 'Built-in Pro Database (Initialized)');
  }
});
