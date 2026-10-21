# Popup & Ad Blocker Pro

A browser extension for **Chrome and Brave** that stops pop-ups, pop-under tabs, fake play
buttons and ad redirects, and blocks thousands of known ad servers.

Created by **Vihanga Shamod** ([@Vihangashamod](https://github.com/Vihangashamod)).

---

## Features

- **No more pop-ups** – sites can't open new tabs or pop-under windows.
- **Safe play buttons** – clicks on hidden ad links are cancelled, but the video still plays.
- **No invisible click traps** – see-through overlays that cover the page are removed.
- **Cleaner pages** – banner slots and fake player buttons are hidden.
- **3,600+ ad servers blocked** on every website, updated daily or with one click.
- **One-click control** – protect, open or remove any site from the popup.

## Install

1. Download this repository (**Code → Download ZIP**, then unzip) or clone it:
   ```bash
   git clone https://github.com/Vihangashamod/popup-ad-blocker.git
   ```
2. Open `brave://extensions` (Brave) or `chrome://extensions` (Chrome).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the folder that contains `manifest.json`.

## How to use

Click the extension icon to open the popup.

| Tab | What you can do |
|---|---|
| **Dashboard** | See if the current site is protected, turn protection on or off, view stats |
| **Ad Filter Lists** | Update the ad-server list now (it also updates itself every 24 hours) |
| **Protected Sites** | Search, add, open (↗) or remove (✕) sites |

- Removing a site always asks **Yes / No** first.
- Built-in sites you remove can be brought back with **Restore**.
- Your own sites and settings are saved in the browser, so they survive updates.

## Update

```bash
cd popup-ad-blocker
git pull
```

Then click the **reload** arrow on the extension's card in `brave://extensions`.

## Built-in sites

The default protected sites are listed in `sites.js`. Add or remove entries there, or do it
from the popup.

## Project files

| File | What it does |
|---|---|
| `manifest.json` | Extension settings and permissions |
| `background.js` | Blocking rules, list updates, statistics |
| `nopopup.js` | Pop-up, ad-link and click-trap protection inside pages |
| `off-flag.js` | Turns protection off for sites you removed |
| `content-bridge.js` | Connects page protection with the extension |
| `popup.html`, `popup.js` | The popup window |
| `sites.js` | Built-in protected sites |
| `default-ad-domains.js` | Built-in list of known ad servers |
| `rules.json` | Fixed blocking rules |
| `icons/` | Extension icons |
| `safari/` | Experimental Xcode project for Safari on macOS |

## Credits

Ad-server list includes [Peter Lowe's Ad and tracking server list](https://pgl.yoyo.org/adservers/).

---

© 2026 Vihanga Shamod
