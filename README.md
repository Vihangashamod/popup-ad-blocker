# Popup & Ad Blocker Pro (v2.0)

A high-performance browser extension (Manifest V3) for **Chrome, Brave, and Safari (macOS)** that stops aggressive pop-up and pop-under tabs, ad redirects, fake player controls, invisible full-screen click traps, and rotating ad networks—especially inside video streaming players and ad-heavy sites.

---

## What It Does & Key Capabilities

| Feature | Details | Where It Applies |
|---|---|---|
| **Blocks Pop-Up & Pop-Under Tabs** | Overrides `window.open()` permanently with a non-configurable lock and neutralizes `HTMLIFrameElement.prototype.contentWindow` to prevent helper-iframe workarounds. | Protected sites & all embedded iframe players |
| **Defuses "Ad Link" Triggers** | Intercepts link clicks that attempt to launch external third-party origins in a new tab (`target="_blank"`), while allowing original video player events (like play/pause) to proceed. Preserves deliberate shortcuts (Cmd/Ctrl/Shift + Click). | Protected sites & nested frames |
| **Neutralizes Invisible Click Traps** | Detects and disables high-z-index full-screen transparent overlays (`opacity: 0`, `z-index: 2147483647`) and cancels programmatic synthetic clicks (`a.click()`, `dispatchEvent`). | Protected sites |
| **Hides Banners & Fake Buttons** | Injected stylesheet cleans banner slots (`.banner_wrapper`, `#mobile-banner`), fake player overlays (`#fakeplayer`, `[data-nume="fake"]`), and floating ad traps. | Protected sites |
| **Blocks 3,600+ Known Ad Domains** | Uses Chrome's high-speed declarativeNetRequest (DNR) engine to block requests to thousands of ad servers, popunder hubs, and tracking networks natively in browser core. | Global across all browsing |
| **Blocks Rotating URL Patterns** | Blocks ad networks rotating domain names every few hours using regular expression and URL-path heuristics. | Tabs viewing protected sites |
| **Instant One-Click Site Protection** | Toggle protection for any site directly from the extension popup. Immediately applies DOM and network protections without reloading the extension. | Current active tab |
| **One-Click Ad List Updates** | Click **Check & Update Lists** right in the popup to fetch the latest ad & popunder blocklists from live feeds (Peter Lowe, AdGuard, Pro database), dynamically recompiling declarative net rules. | On demand & auto-syncs every 24h |

---

## How to Install

### Chrome & Brave

1. Download or clone this folder:
   ```bash
   git clone https://github.com/codebysanka/popup-ad-blocker.git
   ```
2. Navigate to your browser's extensions manager:
   - **Brave:** `brave://extensions`
   - **Chrome:** `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this directory (the one containing `manifest.json`).
5. The **Popup & Ad Blocker Pro** icon will appear in your toolbar.

---

## How to Check & Update the Lists

To ensure your ad filters and pop-under rules stay ahead of newly registered ad domains:

1. Click the **Popup & Ad Blocker Pro** icon in your browser toolbar.
2. Under the **Dashboard** tab or the **Ad Filter Lists** tab, click **"Check & Update Lists"**.
3. The extension connects to live filter feeds, recompiles rules, and instantly applies them to Chrome's `declarativeNetRequest` dynamic rules.
4. The popup will display a confirmation: `✓ Successfully updated! 3,600+ domains active`.
5. *(Optional)* The extension also features an automatic background timer (`chrome.alarms`) that checks for updates once every 24 hours.

---

## Adding Protected Sites

There are two easy ways to add protected sites:

### Option A: From the Extension Popup (Instant)
1. Open any streaming site in your browser.
2. Click the extension icon.
3. The popup automatically detects the site. Click **"+ Protect This Site"**.
4. Full pop-up, pop-under, and ad-link protections activate immediately.

### Opening and removing sites
- Every site in the **Protected Sites** tab has a **↗** button that opens it in a new tab.
- The **✕** button removes any site, built-in ones included. It asks **"Remove …? Yes / No"**
  first and cancels itself after 5 seconds. On the Dashboard, **Disable Protection** needs a
  second click to confirm.
- Removed built-in sites are remembered in the browser, not deleted from `sites.js`.
  **Restore removed built-in sites** brings them all back; adding one again in the form restores it.

### Option B: Built-in Defaults (`sites.js`)
- Pre-populated with 7 film streaming sites. Video players embedded in these sites are protected too.
- You can add domains to `sites.js` and click **"Copy full list for sites.js"** in the popup to export your combined list.

---

## Safari (macOS)

The `safari/` directory contains the native Xcode project for packaging the extension for Safari on macOS (Safari 15.4+).

1. Open `safari/Popup Ad Blocker/Popup Ad Blocker.xcodeproj` in Xcode or run from terminal:
   ```bash
   cd "safari/Popup Ad Blocker"
   xcodebuild -scheme "Popup Ad Blocker" -configuration Release -derivedDataPath /tmp/popup-ad-blocker-build build
   rm -rf ~/Applications/"Popup Ad Blocker.app"
   cp -R "/tmp/popup-ad-blocker-build/Build/Products/Release/Popup Ad Blocker.app" ~/Applications/
   open ~/Applications/"Popup Ad Blocker.app"
   rm -rf /tmp/popup-ad-blocker-build
   ```
2. In Safari: **Settings → Advanced** → check **Show features for web developers**.
3. In Safari: **Settings → Developer** → check **Allow unsigned extensions**.
4. In Safari: **Settings → Extensions** → enable **Popup Ad Blocker** and grant permission for all websites.

---

## Project Structure

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 extension definition with declarativeNetRequest, activeTab, storage, and alarms permissions |
| `background.js` | Service worker managing session/dynamic declarative rules, list updater engine, and statistics |
| `sites.js` | Default list of 7 protected film streaming sites |
| `default-ad-domains.js` | Offline database of 3,600+ curated ad and tracker domains |
| `rules.json` | Static declarativeNetRequest rules for persistent domain and regex blocking |
| `nopopup.js` | Main-world content script neutralizing `window.open`, intercepting sneaky links, and removing click traps |
| `content-bridge.js` | Isolated-world content script synchronizing storage and reporting blocked events to the background worker |
| `popup.html` | Polished dashboard UI featuring live tab toggle, statistics, tab navigation, and list update controls |
| `popup.js` | Popup controller handling interactions, search filtering, and update triggers |
| `icons/` | Crisp extension shield icons (16px, 32px, 48px, 128px) |
| `safari/` | Xcode project packaging the extension as a native macOS Safari app |
