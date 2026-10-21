// End-to-end test: loads the unpacked extension into Chromium and checks that it actually blocks.
//
//   cd tests && npm install && node e2e.mjs
//
// Everything runs against a local web server; well-known ad/tracker/YouTube hostnames are mapped
// to it with --host-resolver-rules, so the test needs no internet and is repeatable.

import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

// ---------------------------------------------------------------------------- test pages
const PAGES = {
  '/news': `<!doctype html><title>news</title>
    <div id="content">Article text</div>
    <div class="ad_banner" id="generic-ad">GENERIC AD</div>
    <img id="dc" src="http://ad.doubleclick.net/pixel.gif">
    <script src="http://www.google-analytics.com/analytics.js"></script>
    <img id="ok" src="/ok.gif">`,
  '/watch': `<!doctype html><title>yt</title>
    <script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"x"},"adPlacements":[{"a":1}],"playerAds":[1]};</script>
    <div id="movie_player" class="html5-video-player ad-showing">
      <video id="v" muted></video>
      <button class="ytp-skip-ad-button" onclick="window.__skipped=true">Skip</button>
    </div>
    <ytd-ad-slot-renderer id="feedad">FEED AD</ytd-ad-slot-renderer>
    <script>
      window.__fromFetch = fetch('/youtubei/v1/player').then(r => r.json());
      window.__fromParse = JSON.parse('{"adPlacements":[1],"playerResponse":{"adSlots":[1]},"keep":1}');
    </script>`,
  '/youtubei/v1/player': '{"videoDetails":{"videoId":"y"},"adPlacements":[{"b":2}],"adSlots":[1]}',
  '/streaming': `<!doctype html><title>stream</title>
    <a id="adlink" href="http://evil-ads.example/landing" target="_blank">PLAY</a>
    <script>window.__openResult = String(window.open('http://evil-ads.example/pop'));</script>`,
};

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/ok.gif' || path.endsWith('.gif')) { res.writeHead(200, { 'content-type': 'image/gif' }); return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }
  if (path.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__trackerRan = true;'); }
  const body = PAGES[path];
  res.writeHead(body ? 200 : 404, { 'content-type': path.startsWith('/youtubei') ? 'application/json' : 'text/html' });
  res.end(body || 'not found');
});
await new Promise((r) => server.listen(PORT, r));

// ---------------------------------------------------------------------------- browser
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pab-')), {
  headless: true,
  channel: 'chromium', // full Chromium in new headless mode (the headless shell can't run extensions)
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP * 127.0.0.1:${PORT}`,
    '--no-proxy-server',
  ],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const swErrors = [];
sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });
await new Promise((r) => setTimeout(r, 1500)); // onInstalled work

const enabled = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
check('All three static rulesets enabled', ['easylist', 'easyprivacy', 'custom'].every((id) => enabled.includes(id)), enabled.join(', '));
const scripts = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)));
check('YouTube script registered', scripts.includes('pab-youtube'), scripts.join(', '));

const visit = async (url) => {
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url() + ' ' + r.failure()?.errorText));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  return { page, failed };
};

// ---- general site: network + cosmetic
{
  const { page, failed } = await visit('http://news.example/news');
  check('Ad server request blocked (EasyList)', failed.some((f) => f.includes('doubleclick.net') && f.includes('BLOCKED_BY_CLIENT')));
  check('Tracker script blocked (EasyPrivacy)', failed.some((f) => f.includes('google-analytics.com')) && !(await page.evaluate(() => window.__trackerRan)));
  check('Normal image still loads', !failed.some((f) => f.includes('/ok.gif')));
  check('Generic ad element hidden (cosmetic)', await page.$eval('#generic-ad', (e) => getComputedStyle(e).display === 'none'));
  check('Normal content visible', await page.$eval('#content', (e) => getComputedStyle(e).display !== 'none'));
  await page.close();
}

// ---- pause on this site
{
  await sw.evaluate(() => chrome.storage.local.set({ pausedSites: ['news.example'] }));
  await new Promise((r) => setTimeout(r, 800));
  const { page, failed } = await visit('http://news.example/news');
  check('Paused site: requests allowed', !failed.some((f) => f.includes('doubleclick.net')));
  check('Paused site: no element hiding', await page.$eval('#generic-ad', (e) => getComputedStyle(e).display !== 'none'));
  await page.close();
  await sw.evaluate(() => chrome.storage.local.set({ pausedSites: [] }));
  await new Promise((r) => setTimeout(r, 800));
}

// ---- YouTube
{
  const { page } = await visit('http://www.youtube.com/watch');
  const initial = await page.evaluate(() => window.ytInitialPlayerResponse);
  check('YouTube: ads removed from ytInitialPlayerResponse', !('adPlacements' in initial) && !('playerAds' in initial) && initial.videoDetails?.videoId === 'x');
  const fetched = await page.evaluate(() => window.__fromFetch);
  check('YouTube: ads removed from /youtubei/v1/player response', !('adPlacements' in fetched) && !('adSlots' in fetched) && fetched.videoDetails?.videoId === 'y');
  const parsed = await page.evaluate(() => window.__fromParse);
  check('YouTube: ads removed from JSON.parse results', !('adPlacements' in parsed) && !('adSlots' in parsed.playerResponse) && parsed.keep === 1);
  check('YouTube: skip button pressed on a showing ad', await page.evaluate(() => window.__skipped === true));
  check('YouTube: feed ad slot hidden', await page.$eval('#feedad', (e) => getComputedStyle(e).display === 'none'));
  check('YouTube: JSON.parse still looks native', await page.evaluate(() => JSON.parse.toString().includes('[native code]')));
  await page.close();
}

// ---- strict pop-up protection on a user-added site
{
  await sw.evaluate(() => chrome.storage.local.set({ extraSites: ['stream.example'] }));
  // wait until background.js has registered the page script for the new site
  await sw.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const ids = (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id);
      if (ids.includes('pab-extras')) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  const before = ctx.pages().length;
  const { page } = await visit('http://stream.example/streaming');
  check('Protected site: window.open blocked at page start', (await page.evaluate(() => window.__openResult)) === 'null');
  await page.click('#adlink');
  await page.waitForTimeout(500);
  check('Protected site: ad link did not open a new tab', ctx.pages().length === before + 1);
  await page.close();
}

check('No errors in the background worker', swErrors.length === 0, swErrors.slice(0, 3).join(' | '));

await ctx.close();
server.close();
const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
process.exit(failedCount ? 1 : 0);
