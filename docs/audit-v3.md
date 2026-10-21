# Audit: Popup & Ad Blocker Pro v3.0

Date: 21 October 2026. Scope: every file in the extension, the filter build (`tools/`) and the
tests (`tests/`). Method: code review, plus measurements in Chromium 141 (Playwright): 18
functional checks, a performance benchmark with and without the extension, and validation of
every compiled rule by Chromium's own parser.

## Summary

| | |
|---|---|
| Functional tests | 18/18 pass, stable over 5 runs |
| Page load overhead | +64 ms on a 3,000-post page (273 → 337 ms) |
| Restyle overhead | +16 ms (14 → 30 ms) |
| Network rules | 15,652 Chrome rules from ~115,000 filters (limit: 30,000 guaranteed) |
| Regex rules | 17/17 accepted by Chrome |
| CSS selectors | 23,729/23,729 accepted by Chrome |
| v2 audit issues | 6/6 major and 5/6 minor fixed (fake stats events remain, low impact) |

## Found and fixed during this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| A1 | **Critical** | Element hiding wrapped selectors in `:is(...)`. That stops Chrome indexing them, so every element was tested against all ~14,000 selectors. Measured: page load 314 → 3,222 ms, restyle 14 → 584 ms. | Plain selector lists (selectors are pre-validated in Chromium, so `:is()`'s error tolerance isn't needed). Now +64 ms / +16 ms. |
| A2 | Medium | Sites added from the popup got strict pop-up protection only about 1 run in 3: Chrome won't inject `nopopup.js` twice into one frame, so the dynamically registered copy never ran. | `force-flag.js` now calls a hook left by `nopopup.js` instead of re-injecting it. 5/5 runs pass. |
| A3 | Medium | Overlapping script re-registrations could fail with "duplicate script id". | Registrations are queued. |
| A4 | Low | Frames inside a paused site (embeds, widgets) still received element hiding. | Checks the tab's top-level site too. |
| A5 | Low | 15 EasyList/EasyPrivacy regex rules and 4 selectors are rejected by Chrome (memory limit / invalid syntax), causing warnings. | Build validates in Chromium and drops them. |

## Open findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| O1 | **High** | **YouTube is untested against the live site.** The tests use a local copy of YouTube's page structure. YouTube changes its ad delivery every few weeks and actively detects ad blockers (warning dialog, playback delay). Removing `adPlacements` is a common technique that YouTube has targeted before. | Test on real YouTube on several videos, logged in and out; keep `youtube.js` small and easy to update; record results per date for the thesis. |
| O2 | **High** | **Publishing risk of `sites.js`.** The repository ships a curated list of 117 unlicensed streaming sites and a launcher for them. That invites DMCA takedown notices on GitHub, would fail Chrome Web Store review, and can weaken the thesis' framing as a security tool. | Ship `sites.js` empty or with neutral examples; keep personal lists in browser storage (the popup already supports this). |
| O3 | Medium | **No licence file.** The compiled `rulesets/` and `filters/` are derived from EasyList, which is dual-licensed GPLv3 / CC BY-SA 3.0. Redistributing them requires attribution and share-alike. | Add a `LICENSE` (GPLv3 fits) and keep the EasyList credit in the README. |
| O4 | Medium | **Ads can flash before hiding.** CSS is injected from the background worker on `webNavigation.onCommitted`. If the worker is asleep, waking it takes tens of milliseconds, so an ad can be visible briefly. | Move generic hiding into a declared content-script stylesheet, keep site-specific CSS in the worker. |
| O5 | Medium | **Remaining load overhead (+64 ms)** comes from parsing ~600 KB of CSS per page, in every frame including ad iframes. | Inject only site-specific rules into sub-frames, or split generic rules into common/rare sets. |
| O6 | Medium | **No real-world evaluation.** All measurements use local pages. | Measure on a fixed sample of popular sites (requests blocked, page weight, load time, breakage) versus uBlock Origin Lite and Brave Shields. |
| O7 | Low | Frames created as `about:blank` (common for ads written with `document.write`) get no element hiding. | Also inject into `about:blank` frames using their parent's site. |
| O8 | Low | The "requests blocked on this page" count includes requests matched by allow rules, so it slightly over-counts. | Count only block rules (needs `declarativeNetRequestFeedback`, or a rule-id lookup). |
| O9 | Low | Any page can send fake "blocked" events through `content-bridge.js` and inflate the stats. | Accept (stats only) or verify events against `nopopup.js` with a per-page secret. |
| O10 | Low | Broad permissions (`<all_urls>`, `scripting`, `webNavigation`) are needed for a general blocker, but mean a longer Chrome Web Store review. | Document why each permission is needed. |
| O11 | Low | 1,049 filters are skipped: `$csp`, `$redirect`, `$rewrite`, scriptlets (`+js`) and procedural filters (`:has-text`). | Expected under Manifest V3; list in the thesis as a limitation. |
| O12 | Low | Safari: the Xcode project now bundles every file, but `registerContentScripts` with `world: "MAIN"` and `insertCSS` aren't verified in Safari. | Build and test in Safari before claiming Safari support. |
| O13 | Low | Popup: the Watch tab's category counts don't change while searching, and the list is slightly cut off at the bottom. | Cosmetic UI fix. |

## How to reproduce

```bash
cd tests && npm install
npm test               # functional checks
node bench.mjs         # performance
node check-rules.mjs   # Chrome validation of every rule and selector
```
