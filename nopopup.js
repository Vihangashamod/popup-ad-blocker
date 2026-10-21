// Runs in every frame, before any page script. Only acts when the tab's top-level site
// or current site is listed in sites.js or added via extension storage.
// Protections:
//   1. window.open() is permanently neutralized (including in created iframes)
//   2. Cancels ad link clicks attempting to open external targets in new tabs (target="_blank")
//   3. Blocks script-initiated synthetic clicks on hidden ad links (a.click())
//   4. Hides banner slots, fake player overlays and neutralizes full-screen transparent click traps
(() => {
  const sites = Array.isArray(self.BLOCK_SITES) ? [...self.BLOCK_SITES] : [];
  delete self.BLOCK_SITES;
  delete self.SITE_GROUPS; // don't leave the site list visible to the page

  const a = location.ancestorOrigins;
  let topSite;
  try {
    topSite = new URL(a && a.length ? a[a.length - 1] : location.origin).hostname;
  } catch {
    topSite = location.hostname;
  }

  const isMatched = (domain, list) => {
    if (!domain || !list || !list.length) return false;
    const clean = domain.toLowerCase().replace(/^www\./, '');
    return list.some(s => {
      const target = s.toLowerCase().replace(/^www\./, '');
      return clean === target || clean.endsWith('.' + target);
    });
  };

  const protect = (activeSite) => {
    if (window.__PAB_ACTIVE__) return;
    window.__PAB_ACTIVE__ = true;

    const notifyBlock = (type) => {
      try {
        window.dispatchEvent(new CustomEvent('__PAB_BLOCKED__', { detail: { type } }));
      } catch {}
    };

    const noOpen = () => {
      notifyBlock('popup');
      return null;
    };

    // Replace window.open
    try {
      Object.defineProperty(window, 'open', { value: noOpen, writable: false, configurable: false });
    } catch {}

    // Patch iframe.contentWindow so helper iframes cannot spawn popups
    try {
      const cw = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      if (cw && cw.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          ...cw,
          get() {
            const w = cw.get.call(this);
            try {
              if (w && w.open !== noOpen) {
                Object.defineProperty(w, 'open', { value: noOpen, writable: false, configurable: false });
              }
            } catch {}
            return w;
          },
        });
      }
    } catch {}

    const ours = (h) => {
      if (!h) return true;
      const cleanH = h.toLowerCase().replace(/^www\./, '');
      const cleanSite = (activeSite || '').toLowerCase().replace(/^www\./, '');
      const cleanLoc = location.hostname.toLowerCase().replace(/^www\./, '');
      return cleanH === cleanSite || cleanH.endsWith('.' + cleanSite) || cleanH === cleanLoc || cleanH.endsWith('.' + cleanLoc);
    };

    const isAdLink = (aEl) => {
      if (!aEl || !aEl.href) return false;
      const target = aEl.target || '';
      if (!target || /^_(self|top|parent)$/i.test(target)) return false;
      try {
        const destHost = new URL(aEl.href, location.href).hostname;
        return !ours(destHost);
      } catch {
        return false;
      }
    };

    // Intercept user clicks on sneaky new-tab ad links
    addEventListener('click', (e) => {
      // Respect deliberate user shortcuts (Cmd, Ctrl, Shift, Alt)
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target.closest?.('a[href]');
      if (isAdLink(anchor)) {
        e.preventDefault();
        notifyBlock('link');
      }
    }, true);

    // Cancel script-driven programmatic clicks on detached / hidden links
    const guard = (aEl) => {
      if (isAdLink(aEl)) {
        aEl.addEventListener('click', (e) => {
          e.preventDefault();
          notifyBlock('link');
        }, { once: true, capture: true });
      }
    };

    try {
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        guard(this);
        return origClick.call(this);
      };

      const origDispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function (e) {
        if (this instanceof HTMLAnchorElement && e?.type === 'click') guard(this);
        return origDispatch.call(this, e);
      };
    } catch {}

    // Cosmetic Ad & Overlay Defusal
    const applyStyles = () => {
      const cssText = `
        .banner_wrapper, .banner-sidebar, #mobile-banner, [data-ad-slot],
        [data-nume="fake"], .display-fake, #fakeplayer, #playernotice,
        .ad-container, .adsbygoogle, .click-trap, [class*="popunder"],
        body > div[style*="z-index: 2147483647"],
        body > div[style*="z-index: 9999999"],
        body > a[target="_blank"][style*="position: fixed"],
        body > a[target="_blank"][style*="position: absolute"][style*="width: 100%"] {
          display: none !important;
          pointer-events: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }
      `;
      try {
        if ('adoptedStyleSheets' in document) {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(cssText);
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        } else {
          const style = document.createElement('style');
          style.textContent = cssText;
          (document.head || document.documentElement).appendChild(style);
        }
      } catch {}
    };

    applyStyles();

    // Neutralize dynamic full-screen transparent click traps
    const neutralizeOverlays = () => {
      try {
        const suspicious = document.querySelectorAll('body > div, body > a');
        for (const el of suspicious) {
          const s = window.getComputedStyle(el);
          if ((s.position === 'fixed' || s.position === 'absolute') &&
              parseInt(s.zIndex || '0', 10) > 100000 &&
              (parseFloat(s.opacity) < 0.1 || s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent') &&
              el.offsetWidth >= window.innerWidth * 0.7 &&
              el.offsetHeight >= window.innerHeight * 0.7) {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            notifyBlock('element');
          }
        }
      } catch {}
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', neutralizeOverlays, { once: true });
    } else {
      neutralizeOverlays();
    }

    try {
      const observer = new MutationObserver(() => neutralizeOverlays());
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
  };

  const init = () => {
    // If running in isolated world (e.g. Safari), inject into page MAIN world
    if (globalThis.browser?.runtime?.id || globalThis.chrome?.runtime?.id) {
      const s = document.createElement('script');
      s.textContent = `(${protect})(${JSON.stringify(topSite)})`;
      document.documentElement.append(s);
      s.remove();
    } else {
      protect(topSite);
    }
  };

  // Immediate check against built-in sites
  if (isMatched(topSite, sites) || isMatched(location.hostname, sites)) {
    init();
  }

  // Also listen for dynamic sites sent from content-bridge.js
  const checkDynamic = (extraList) => {
    if (isMatched(topSite, extraList) || isMatched(location.hostname, extraList)) {
      init();
    }
  };

  window.addEventListener('__PAB_SYNC_SITES__', (e) => {
    if (Array.isArray(e.detail?.extraSites)) {
      checkDynamic(e.detail.extraSites);
    }
  });

  try {
    if (document.documentElement?.dataset?.pabExtras) {
      const parsed = JSON.parse(document.documentElement.dataset.pabExtras);
      checkDynamic(parsed);
    }
  } catch {}
})();
