# Popup & Ad Blocker Pro (v3.0)

**Authors:** Vihanga Shamod ([@Vihangashamod](https://github.com/Vihangashamod)) and [@codebysanka](https://github.com/codebysanka)
Developed as part of a master's thesis project.

A Manifest V3 ad blocker for **Chrome, Brave and Edge** (Safari project included). It blocks ads and
trackers on **every site, including YouTube**, and adds extra pop-up and pop-under protection for
streaming sites.

## What it does

| Layer | How | Where |
|---|---|---|
| **Ad blocking** | EasyList compiled to Chrome's built-in `declarativeNetRequest` engine (about 59,000 filters) | Every site |
| **Tracker blocking** | EasyPrivacy, compiled the same way (about 56,000 filters) | Every site |
| **Element hiding** | EasyList cosmetic filters (about 13,600 general rules + rules for 7,800 sites), injected as a user stylesheet into every frame | Every site |
| **YouTube** | Removes the ad schedule from the player's data before the player reads it; mutes, skips and presses "Skip" on any ad that still starts; hides feed, sidebar and banner ads | youtube.com, music.youtube.com, m.youtube.com, embeds |
| **Live ad-server list** | Peter Lowe's list + a built-in database of 3,600+ domains, refreshed daily or with one click | Every site |
| **Strict pop-up protection** | Locks `window.open()`, cancels ad links that open new tabs, stops script-fired clicks, removes invisible full-page click traps, blocks rotating ad-network URL patterns | Sites in `sites.js` + sites added in the popup |
| **Pause on this site** | One switch turns everything off for the current site | Per site |

The toolbar badge shows how many requests were blocked on the current tab.

## Install (Chrome, Brave, Edge)

1. Download or clone this repository.
2. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick this folder (the one containing `manifest.json`).

The filter lists are already compiled into `rulesets/` and `filters/`, so nothing else is needed.

## Using it

- **Watch** tab: your protected sites by category, with search, favourites and recently opened.
- **Dashboard**: the switch at the top turns ad blocking on or off for the current site. Below it,
  "Strict pop-up protection" adds the current site to the protected list.
- **Filters**: switch EasyList, EasyPrivacy or the custom rules on and off; refresh the live ad-server list.
- **Sites**: add or remove protected sites.

## Updating the filter lists

The lists are compiled from the EasyList repository at build time:

```bash
cd tests && npm install          # optional: lets the build validate rules in real Chromium
cd ../tools && npm install --ignore-scripts
npm run build                    # writes rulesets/*.json and filters/*.json
```

Then click the reload arrow on the extension's card. Add your own rules to
`tools/custom-filters.txt` (Adblock Plus syntax) and rebuild.

## Tests

```bash
cd tests && npm install
npm test            # 18 functional checks
node bench.mjs      # performance with and without the extension
```

Loads the extension into Chromium and runs 18 checks against local test pages: ad and tracker
requests blocked, ad elements hidden, normal content untouched, pause works, YouTube ad data removed
and ads skipped, pop-ups blocked on protected sites, and no background errors. Real ad and YouTube
hostnames are mapped to a local server, so the test needs no internet.

## Evaluation

All numbers come from the scripts in `tests/`, run in Chromium 141 (Playwright) on local test
pages, so they're repeatable without internet access.

**Functional tests (`npm test`)**: 18 of 18 checks pass, stable over 5 consecutive runs.

| Area | What is checked |
|---|---|
| Network blocking | Ad server (EasyList) and tracker script (EasyPrivacy) are blocked; normal images still load |
| Element hiding | Generic ad element hidden; normal content visible |
| Pause | Paused site loads ads and shows ad elements again |
| YouTube | Ad data removed from `ytInitialPlayerResponse`, from `/youtubei/v1/player` responses and from `JSON.parse` results; a showing ad is skipped; feed ad slot hidden; `JSON.parse` still looks native |
| Pop-up protection | `window.open` blocked from page start on a user-added site; ad link doesn't open a tab |
| Stability | No errors in the background worker |

**Performance (`node bench.mjs`)**: large page with 3,000 posts, median of 8 loads.

| | Without extension | With extension | Overhead |
|---|---|---|---|
| Page load | 273 ms | 337 ms | +64 ms |
| Restyle of all elements | 14 ms | 30 ms | +16 ms |

**Rule validation (`node check-rules.mjs`)**: every regex rule and CSS selector is checked by
Chromium itself at build time; the current build ships 17/17 valid regex rules and 23,729/23,729
valid selectors (15 regex rules and 4 selectors that Chrome rejects are removed automatically).

## Known limits

- **YouTube changes often.** Its ad formats and anti-ad-blocker checks change every few weeks; when
  that happens, ads can reappear until `youtube.js` or `tools/custom-filters.txt` is updated.
  Server-side inserted ads (ads stitched into the video stream itself) can't be removed by any
  extension, only skipped.
- **Manifest V3 limits.** Chrome doesn't let extensions download new network rules into the
  static rulesets, so EasyList/EasyPrivacy updates need a rebuild; the live ad-server list
  updates itself.
- **Not covered:** uBlock Origin-style scriptlets and procedural filters (`:has-text`, `+js(...)`),
  and `$csp`/`$redirect` filters.
- **Safari:** the Xcode project includes all files, but the YouTube module and cosmetic injection
  rely on Chrome APIs (`scripting.registerContentScripts` with `world: MAIN`,
  `scripting.insertCSS`) and haven't been tested in Safari.

## Project structure

| Path | Purpose |
|---|---|
| `manifest.json` | Extension definition |
| `background.js` | Service worker: rulesets, element hiding, pause, YouTube registration, list updates, stats |
| `youtube.js` | YouTube ad removal (runs in the page) |
| `nopopup.js` | Strict pop-up protection for protected sites (runs in the page) |
| `force-flag.js` | Turns on `nopopup.js` immediately for sites added in the popup |
| `content-bridge.js` | Passes stats and user-added sites between page scripts and the extension |
| `sites.js` | Built-in protected sites, by category |
| `default-ad-domains.js` | Offline ad-domain database used by the live list |
| `rulesets/` | Compiled network rules (EasyList, EasyPrivacy, custom) |
| `filters/` | Compiled element-hiding rules and list metadata |
| `popup.html`, `popup.js` | Popup UI |
| `tools/` | Filter compiler, custom filters, legacy rules |
| `tests/` | End-to-end tests, performance benchmark, Chrome rule validation |
| `docs/` | Audit reports |
| `safari/` | Xcode project for Safari (macOS) |

## Credits and licences

Filter lists by [EasyList](https://easylist.to/) (dual-licensed GPLv3 / CC BY-SA 3.0) and
[Peter Lowe's list](https://pgl.yoyo.org/adservers/). Filters are converted with eyeo's
`webext-ad-filtering-solution` (GPLv3), used only at build time.
