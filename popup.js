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
let cachedRemoved = []; // built-in sites the user removed

// Built-in sites minus the ones the user removed
const activeBuiltin = () => builtin.filter(s => !cachedRemoved.includes(s));
const matchesSite = (domain, s) => domain === s || domain.endsWith('.' + s);

// Storage Accessors
const getExtra = () => chrome.storage.local.get({ extraSites: [] }).then(r => r.extraSites || []);
const setExtra = (sites) => chrome.storage.local.set({ extraSites: sites });
const getRemoved = () => chrome.storage.local.get({ removedSites: [] }).then(r => r.removedSites || []);
const setRemoved = (sites) => chrome.storage.local.set({ removedSites: sites });

// Ask before deleting: swaps the given buttons for "Remove? Yes / No" for a few seconds.
const confirmInline = (actions, question, onYes) => {
  const original = [...actions.childNodes];
  const label = document.createElement('span');
  label.className = 'confirm-label';
  label.textContent = question;
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn-confirm yes';
  yes.textContent = 'Yes';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn-confirm no';
  no.textContent = 'No';
  const restore = () => { clearTimeout(timer); actions.replaceChildren(...original); };
  const timer = setTimeout(restore, 5000);
  yes.addEventListener('click', () => { clearTimeout(timer); onYes(); });
  no.addEventListener('click', restore);
  actions.replaceChildren(label, yes, no);
  yes.focus();
};

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
  const all = [...activeBuiltin(), ...cachedExtraSites];
  return all.some(s => matchesSite(clean, s));
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

  if (isProtected) {
    siteStatusBadge.className = 'status-badge on';
    siteStatusBadge.textContent = '🛡️ Protected';
    toggleCurrentSiteBtn.style.display = 'inline-flex';
    toggleCurrentSiteBtn.className = 'btn btn-toggle-on';
    toggleCurrentSiteBtn.textContent = 'Disable Protection';
    toggleCurrentSiteBtn.disabled = false;
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
let disableArmed = null; // first click arms, second click (within 4s) confirms

toggleCurrentSiteBtn.addEventListener('click', async () => {
  if (!currentActiveDomain) return;
  const d = currentActiveDomain;

  if (!isDomainProtected(d)) {
    // Turning protection on: re-enable a removed built-in entry, or add the site
    const removedMatch = cachedRemoved.filter(s => matchesSite(d, s));
    if (removedMatch.length) {
      cachedRemoved = cachedRemoved.filter(s => !removedMatch.includes(s));
      await setRemoved(cachedRemoved);
    } else {
      cachedExtraSites = Array.from(new Set([...cachedExtraSites, d])).sort();
      await setExtra(cachedExtraSites);
    }
    renderAll();
    return;
  }

  // Turning protection off needs a second click to confirm
  if (!disableArmed) {
    toggleCurrentSiteBtn.textContent = 'Click again to confirm';
    toggleCurrentSiteBtn.classList.add('confirming');
    disableArmed = setTimeout(() => { disableArmed = null; refreshActiveSiteWidget(); }, 4000);
    return;
  }
  clearTimeout(disableArmed);
  disableArmed = null;
  toggleCurrentSiteBtn.classList.remove('confirming');

  // Remove every entry that covers this site (user-added and built-in, including parent domains)
  cachedExtraSites = cachedExtraSites.filter(s => !matchesSite(d, s));
  cachedRemoved = Array.from(new Set([...cachedRemoved, ...builtin.filter(s => matchesSite(d, s))])).sort();
  await chrome.storage.local.set({ extraSites: cachedExtraSites, removedSites: cachedRemoved });
  renderAll();
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
const makeRemoveBtn = (site, onConfirmed) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-remove';
  btn.textContent = '✕';
  btn.title = `Remove ${site}`;
  btn.addEventListener('click', () => confirmInline(btn.parentElement, `Remove ${site}?`, onConfirmed));
  return btn;
};

const renderBuiltin = (filter = '') => {
  builtinList.innerHTML = '';
  const list = activeBuiltin();
  const filtered = list.filter(s => s.toLowerCase().includes(filter.toLowerCase()));
  builtinCount.textContent = list.length;

  for (const site of filtered) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'site-name';
    span.textContent = site;
    const actions = document.createElement('span');
    actions.className = 'site-actions';
    actions.append(makeOpenBtn(site), makeRemoveBtn(site, async () => {
      cachedRemoved = Array.from(new Set([...cachedRemoved, site])).sort();
      await setRemoved(cachedRemoved);
      renderAll();
    }));
    li.append(span, actions);
    builtinList.appendChild(li);
  }

  // "Restore removed" button
  restoreBtn.style.display = cachedRemoved.length ? 'flex' : 'none';
  restoreBtn.textContent = `Restore ${cachedRemoved.length} removed built-in site${cachedRemoved.length === 1 ? '' : 's'}`;
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

    const removeBtn = makeRemoveBtn(site, async () => {
      cachedExtraSites = (await getExtra()).filter(s => s !== site);
      await setExtra(cachedExtraSites);
      renderAll();
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
  if (cachedRemoved.includes(domain)) {
    // Adding a removed built-in site brings it back
    cachedRemoved = cachedRemoved.filter(s => s !== domain);
    await setRemoved(cachedRemoved);
    addInput.value = '';
    renderAll();
    return;
  }
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
  const all = Array.from(new Set([...activeBuiltin(), ...cachedExtraSites])).sort();
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

// Restore all removed built-in sites (not destructive, so no confirmation)
const restoreBtn = $('restoreBtn');
restoreBtn.addEventListener('click', async () => {
  cachedRemoved = [];
  await setRemoved([]);
  renderAll();
});

const renderAll = () => {
  const q = siteSearchInput.value.trim();
  renderBuiltin(q);
  renderExtra(cachedExtraSites, q);
  refreshActiveSiteWidget();
};

// Initial Setup
Promise.all([getExtra(), getRemoved()]).then(([extra, removed]) => {
  cachedExtraSites = extra;
  // Forget removals of sites that are no longer in sites.js, so they don't show up as
  // "removed built-in sites" waiting to be restored
  cachedRemoved = removed.filter(s => builtin.includes(s));
  if (cachedRemoved.length !== removed.length) setRemoved(cachedRemoved);
  renderAll();
});
loadStats();
