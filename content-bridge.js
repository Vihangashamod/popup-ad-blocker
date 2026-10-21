// content-bridge.js - Runs in ISOLATED world at document_start.
// Bridges extension storage and messages between the background worker and MAIN world nopopup.js.
(() => {
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  const sync = async () => {
    try {
      const res = await chrome.storage.local.get({ extraSites: [] });
      const extras = res.extraSites || [];
      if (document.documentElement) {
        document.documentElement.dataset.pabExtras = JSON.stringify(extras);
      }
      window.dispatchEvent(new CustomEvent('__PAB_SYNC_SITES__', { detail: { extraSites: extras } }));
    } catch {}
  };

  sync();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, { once: true });
  }

  // Listen for changes in storage (e.g. user added site from popup)
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.extraSites) {
        sync();
      }
    });
  } catch {}

  // Listen for blocked actions from nopopup.js and notify background
  window.addEventListener('__PAB_BLOCKED__', (e) => {
    const type = e.detail?.type || 'action';
    try {
      chrome.runtime.sendMessage({ action: 'recordBlock', type, url: location.href });
    } catch {}
  });
})();
