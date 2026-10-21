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

// Tab Switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const panel = $(btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

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

// Button that opens a site in a new tab
const makeOpenBtn = (site) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-open';
  btn.textContent = '↗';
  btn.title = `Open ${site}`;
  btn.addEventListener('click', () => {
    chrome.tabs.create({ url: `https://${site}/` });
    window.close();
  });
  return btn;
};

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
    li.append(span, makeOpenBtn(site));
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

    const actions = document.createElement('span');
    actions.className = 'site-actions';
    actions.append(makeOpenBtn(site), removeBtn);
    li.append(span, actions);
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
