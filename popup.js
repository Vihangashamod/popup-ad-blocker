// Popup & Ad Blocker Pro - UI Controller
const builtin = Array.isArray(self.BLOCK_SITES) ? [...self.BLOCK_SITES].sort() : [];

const domainRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const normalize = (input) => {
  let s = (input || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = 'https://' + s;
  try { s = new URL(s).hostname; } catch { return null; }
  s = s.replace(/^www\./, '');
  return domainRe.test(s) ? s : null;
};

const formatTimeAgo = (isoString) => {
  if (!isoString) return 'Not checked yet';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 45) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

// DOM References
const $ = (id) => document.getElementById(id);
const currentDomainEl = $('currentDomain');
const siteStatusBadge = $('siteStatusBadge');
const toggleCurrentSiteBtn = $('toggleCurrentSiteBtn');

const statPopups = $('statPopups');
const statLinks = $('statLinks');
const statFilters = $('statFilters');

const quickUpdateBtn = $('quickUpdateBtn');
const quickUpdateIcon = $('quickUpdateIcon');
const quickFeedback = $('quickFeedback');
const quickLastUpdated = $('quickLastUpdated');

const fullUpdateBtn = $('fullUpdateBtn');
const fullUpdateIcon = $('fullUpdateIcon');
const fullFeedback = $('fullFeedback');
const fullLastUpdated = $('fullLastUpdated');
const fullAdCount = $('fullAdCount');
const feedSourceName = $('feedSourceName');

const siteSearchInput = $('siteSearchInput');
const builtinList = $('builtin');
const builtinCount = $('builtinCount');
const extraList = $('extra');
const extraCount = $('extraCount');
const extraEmpty = $('extraEmpty');
const addForm = $('addForm');
const addInput = $('addInput');
const addError = $('addError');
const copyBtn = $('copyBtn');

let currentActiveDomain = null;
let cachedExtraSites = [];

// Storage Accessors
const getExtra = () => chrome.storage.local.get({ extraSites: [] }).then(r => r.extraSites || []);
const setExtra = (sites) => chrome.storage.local.set({ extraSites: sites });

// Tab Switching (the last tab used is remembered)
const showTab = (tabId) => {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  const panel = $(tabId);
  if (!btn || !panel) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  panel.classList.add('active');
  if (tabId === 'tabWatch') setTimeout(() => $('watchSearch')?.focus(), 0);
};

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    showTab(btn.dataset.tab);
    chrome.storage.local.set({ lastTab: btn.dataset.tab });
  });
});

chrome.storage.local.get({ lastTab: 'tabDashboard' }).then((r) => showTab(r.lastTab));

// Check if domain is protected
const isDomainProtected = (domain) => {
  if (!domain) return false;
  const clean = domain.toLowerCase().replace(/^www\./, '');
  const all = [...builtin, ...cachedExtraSites];
  return all.some(s => clean === s || clean.endsWith('.' + s));
};

// Render Current Active Site
const refreshActiveSiteWidget = () => {
  if (!currentActiveDomain) {
    currentDomainEl.textContent = 'No active page';
    siteStatusBadge.className = 'status-badge off';
    siteStatusBadge.textContent = 'Inactive';
    toggleCurrentSiteBtn.style.display = 'none';
    return;
  }

  currentDomainEl.textContent = currentActiveDomain;

  const isProtected = isDomainProtected(currentActiveDomain);
  const isBuiltin = builtin.some(s => currentActiveDomain === s || currentActiveDomain.endsWith('.' + s));

  if (isProtected) {
    siteStatusBadge.className = 'status-badge on';
    siteStatusBadge.textContent = '🛡️ Protected';
    toggleCurrentSiteBtn.style.display = 'inline-flex';
    toggleCurrentSiteBtn.className = 'btn btn-toggle-on';
    toggleCurrentSiteBtn.textContent = isBuiltin ? 'Built-in (Always On)' : 'Disable Protection';
    toggleCurrentSiteBtn.disabled = isBuiltin;
  } else {
    siteStatusBadge.className = 'status-badge off';
    siteStatusBadge.textContent = '⚪ Not Protected';
    toggleCurrentSiteBtn.style.display = 'inline-flex';
    toggleCurrentSiteBtn.className = 'btn btn-toggle-off';
    toggleCurrentSiteBtn.textContent = '+ Protect This Site';
    toggleCurrentSiteBtn.disabled = false;
  }
};

// Detect Active Tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0]?.url) {
    try {
      const url = new URL(tabs[0].url);
      if (url.protocol.startsWith('http')) {
        currentActiveDomain = url.hostname.replace(/^www\./, '');
      } else {
        currentActiveDomain = null;
      }
    } catch {
      currentActiveDomain = null;
    }
  }
  refreshActiveSiteWidget();
});

// Toggle Protection for Active Site
toggleCurrentSiteBtn.addEventListener('click', async () => {
  if (!currentActiveDomain) return;
  const isProtected = isDomainProtected(currentActiveDomain);

  let next;
  if (isProtected) {
    next = cachedExtraSites.filter(s => s !== currentActiveDomain);
  } else {
    next = Array.from(new Set([...cachedExtraSites, currentActiveDomain])).sort();
  }

  await setExtra(next);
  cachedExtraSites = next;
  renderExtra(next);
  refreshActiveSiteWidget();
});

// Render Sites Lists
const renderBuiltin = (filter = '') => {
  builtinList.innerHTML = '';
  const filtered = builtin.filter(s => s.toLowerCase().includes(filter.toLowerCase()));
  builtinCount.textContent = builtin.length;

  for (const site of filtered) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'site-name';
    span.textContent = site;
    li.appendChild(span);
    builtinList.appendChild(li);
  }
};

const renderExtra = (extra, filter = '') => {
  extraList.innerHTML = '';
  cachedExtraSites = extra;
  extraCount.textContent = extra.length;

  const filtered = extra.filter(s => s.toLowerCase().includes(filter.toLowerCase()));
  extraEmpty.style.display = filtered.length ? 'none' : 'block';

  for (const site of filtered) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'site-name';
    span.textContent = site;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = `Remove ${site}`;
    removeBtn.addEventListener('click', async () => {
      const next = (await getExtra()).filter(s => s !== site);
      await setExtra(next);
      renderExtra(next, siteSearchInput.value);
      refreshActiveSiteWidget();
    });

    li.append(span, removeBtn);
    extraList.append(li);
  }
};

// Search filter
siteSearchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  renderBuiltin(query);
  renderExtra(cachedExtraSites, query);
});

// Add Form
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addError.textContent = '';
  const domain = normalize(addInput.value);

  if (!domain) {
    addError.textContent = 'Please enter a valid domain (e.g. site.com)';
    return;
  }

  const extra = await getExtra();
  if (builtin.includes(domain) || extra.includes(domain)) {
    addError.textContent = `${domain} is already in the list`;
    return;
  }

  const next = [...extra, domain].sort();
  await setExtra(next);
  renderExtra(next, siteSearchInput.value);
  addInput.value = '';
  refreshActiveSiteWidget();
});

// Copy full list for sites.js
copyBtn.addEventListener('click', async () => {
  const all = Array.from(new Set([...builtin, ...cachedExtraSites])).sort();
  const text = `self.BLOCK_SITES = ${JSON.stringify(all, null, 2)};\n`;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = '✓ Copied to clipboard!';
  } catch {
    copyBtn.textContent = 'Copy failed - please select manually';
  }
  setTimeout(() => {
    copyBtn.textContent = 'Copy full list for sites.js';
  }, 2200);
});

// Load and Display Stats
const loadStats = () => {
  chrome.storage.local.get(['stats', 'lastUpdated', 'adDomainsCount', 'updateSource'], (res) => {
    const stats = res.stats || {};
    statPopups.textContent = (stats.popupsBlocked || 0).toLocaleString();
    statLinks.textContent = (stats.linksDefused || 0).toLocaleString();

    const count = res.adDomainsCount || 3677;
    statFilters.textContent = count.toLocaleString() + '+';
    if (fullAdCount) fullAdCount.textContent = count.toLocaleString() + ' domains';

    const lastUpdatedFormatted = formatTimeAgo(res.lastUpdated);
    if (quickLastUpdated) quickLastUpdated.textContent = `Last updated: ${lastUpdatedFormatted}`;
    if (fullLastUpdated) fullLastUpdated.textContent = res.lastUpdated ? new Date(res.lastUpdated).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Initial database active';

    if (feedSourceName && res.updateSource) {
      feedSourceName.textContent = res.updateSource;
    }
  });
};

// Check & Update Lists Action
const triggerUpdate = (btn, iconEl, feedbackEl) => {
  btn.disabled = true;
  iconEl.innerHTML = '<span class="spinner"></span>';
  feedbackEl.className = 'update-feedback';
  feedbackEl.textContent = 'Checking and updating ad lists...';

  chrome.runtime.sendMessage({ action: 'checkAndUpdateLists' }, (response) => {
    btn.disabled = false;
    iconEl.textContent = '⟳';

    if (response && response.success) {
      feedbackEl.className = 'update-feedback success';
      feedbackEl.textContent = `✓ Successfully updated! ${response.count.toLocaleString()} domains active.`;
      loadStats();
    } else {
      feedbackEl.className = 'update-feedback error';
      feedbackEl.textContent = response?.error ? `Update failed: ${response.error}` : 'Update completed with cached rules.';
      loadStats();
    }

    setTimeout(() => {
      feedbackEl.textContent = '';
    }, 4500);
  });
};

quickUpdateBtn.addEventListener('click', () => {
  triggerUpdate(quickUpdateBtn, quickUpdateIcon, quickFeedback);
});

fullUpdateBtn.addEventListener('click', () => {
  triggerUpdate(fullUpdateBtn, fullUpdateIcon, fullFeedback);
});

// Initial Setup
renderBuiltin();
getExtra().then((extra) => {
  cachedExtraSites = extra;
  renderExtra(extra);
  refreshActiveSiteWidget();
});
loadStats();

// ---------------------------------------------------------------------------
// Watch tab: quick launcher for protected sites
// ---------------------------------------------------------------------------
(() => {
  const GROUPS = self.SITE_GROUPS || {};
  const HIDDEN_GROUPS = new Set(['Video Players']); // embed hosts, not opened directly
  const MAX_RECENT = 6;

  const searchEl = $('watchSearch');
  const chipsEl = $('watchChips');
  const listEl = $('watchList');
  const emptyEl = $('watchEmpty');
  const recentWrap = $('recentWrap');
  const recentRow = $('recentRow');
  const openHereEl = $('openHere');

  let favs = [];
  let recent = [];
  let extras = [];
  let activeChip = 'All';
  let kbIndex = -1;

  // Stable colour per site for the letter avatar
  const hue = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const label = (domain) => domain.split('.')[0];

  const catalog = () => {
    const items = [];
    const seen = new Set();
    for (const [group, sites] of Object.entries(GROUPS)) {
      if (HIDDEN_GROUPS.has(group)) continue;
      for (const d of sites) {
        if (seen.has(d)) continue;
        seen.add(d);
        items.push({ domain: d, group });
      }
    }
    for (const d of extras) {
      if (!seen.has(d)) { seen.add(d); items.push({ domain: d, group: 'My Sites' }); }
    }
    return items;
  };

  const openSite = async (domain) => {
    const url = 'https://' + domain + '/';
    recent = [domain, ...recent.filter((d) => d !== domain)].slice(0, MAX_RECENT);
    await chrome.storage.local.set({ recentSites: recent });
    if (openHereEl.checked) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.update(tab.id, { url });
      else await chrome.tabs.create({ url });
    } else {
      await chrome.tabs.create({ url });
    }
    window.close();
  };

  const toggleFav = async (domain) => {
    favs = favs.includes(domain) ? favs.filter((d) => d !== domain) : [...favs, domain];
    await chrome.storage.local.set({ favSites: favs });
    render();
  };

  const filtered = () => {
    const q = searchEl.value.trim().toLowerCase();
    let items = catalog();
    if (activeChip === '★ Favourites') items = items.filter((i) => favs.includes(i.domain));
    else if (activeChip !== 'All') items = items.filter((i) => i.group === activeChip);
    if (q) items = items.filter((i) => i.domain.includes(q) || i.group.toLowerCase().includes(q));
    // Favourites first, then alphabetical
    return items.sort((a, b) =>
      (favs.includes(b.domain) - favs.includes(a.domain)) || a.domain.localeCompare(b.domain));
  };

  const renderChips = () => {
    const all = catalog();
    const groups = ['All', '★ Favourites', ...new Set(all.map((i) => i.group))];
    chipsEl.innerHTML = '';
    for (const g of groups) {
      const n = g === 'All' ? all.length
        : g === '★ Favourites' ? all.filter((i) => favs.includes(i.domain)).length
        : all.filter((i) => i.group === g).length;
      if (g === '★ Favourites' && !n && activeChip !== g) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (g === activeChip ? ' active' : '');
      b.textContent = g;
      const c = document.createElement('span');
      c.className = 'n';
      c.textContent = n;
      b.append(c);
      b.addEventListener('click', () => {
        activeChip = g;
        chrome.storage.local.set({ watchChip: g });
        render();
      });
      chipsEl.append(b);
    }
  };

  const renderRecent = () => {
    const valid = recent.filter((d) => catalog().some((i) => i.domain === d));
    recentWrap.style.display = valid.length ? 'block' : 'none';
    recentRow.innerHTML = '';
    for (const d of valid) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recent-pill';
      b.textContent = d;
      b.title = 'Open ' + d;
      b.addEventListener('click', () => openSite(d));
      recentRow.append(b);
    }
  };

  const renderList = () => {
    const items = filtered();
    listEl.innerHTML = '';
    emptyEl.style.display = items.length ? 'none' : 'block';
    if (kbIndex >= items.length) kbIndex = items.length - 1;

    items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = 'watch-item' + (idx === kbIndex ? ' kb' : '');
      li.tabIndex = 0;
      li.title = 'Open https://' + it.domain;

      const av = document.createElement('div');
      av.className = 'avatar';
      av.style.background = `hsl(${hue(it.domain)} 55% 42%)`;
      av.textContent = label(it.domain).replace(/[^a-z0-9]/gi, '').slice(0, 2);

      const meta = document.createElement('div');
      meta.className = 'watch-meta';
      const nm = document.createElement('div');
      nm.className = 'watch-name';
      nm.textContent = it.domain;
      const cat = document.createElement('div');
      cat.className = 'watch-cat';
      cat.textContent = it.group;
      meta.append(nm, cat);

      const fav = document.createElement('button');
      fav.type = 'button';
      const isFav = favs.includes(it.domain);
      fav.className = 'icon-btn' + (isFav ? ' fav-on' : '');
      fav.textContent = isFav ? '★' : '☆';
      fav.title = isFav ? 'Remove from favourites' : 'Add to favourites';
      fav.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(it.domain); });

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'icon-btn';
      go.textContent = '↗';
      go.title = 'Open';
      go.addEventListener('click', (e) => { e.stopPropagation(); openSite(it.domain); });

      li.append(av, meta, fav, go);
      li.addEventListener('click', () => openSite(it.domain));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSite(it.domain); });
      listEl.append(li);
    });
  };

  const render = () => { renderChips(); renderRecent(); renderList(); };

  // Keyboard: arrows move, Enter opens the highlighted (or top) result
  searchEl.addEventListener('input', () => { kbIndex = -1; renderList(); });
  searchEl.addEventListener('keydown', (e) => {
    const items = filtered();
    if (e.key === 'ArrowDown') { e.preventDefault(); kbIndex = Math.min(kbIndex + 1, items.length - 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); kbIndex = Math.max(kbIndex - 1, 0); renderList(); }
    else if (e.key === 'Enter' && items.length) { e.preventDefault(); openSite(items[Math.max(kbIndex, 0)].domain); }
  });
  listEl.addEventListener('mousemove', () => {
    if (kbIndex !== -1) { kbIndex = -1; listEl.querySelector('.kb')?.classList.remove('kb'); }
  });

  openHereEl.addEventListener('change', () => chrome.storage.local.set({ openInCurrentTab: openHereEl.checked }));

  // Keep "My Sites" in step with sites added/removed in the Sites tab
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.extraSites) { extras = changes.extraSites.newValue || []; render(); }
  });

  chrome.storage.local.get({ favSites: [], recentSites: [], extraSites: [], openInCurrentTab: false, watchChip: 'All' })
    .then((r) => {
      favs = r.favSites;
      recent = r.recentSites;
      extras = r.extraSites;
      openHereEl.checked = r.openInCurrentTab;
      activeChip = r.watchChip;
      render();
    });
})();
