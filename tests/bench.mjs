// Performance benchmark: page load time and style recalculation on a large page (3,000 posts),
// with and without the extension. Median of 8 page loads each.
//
//   cd tests && node bench.mjs

import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8767;
let html = '<!doctype html><title>bench</title>';
for (let i = 0; i < 3000; i++) html += `<div class="post p${i}"><h3>Title ${i}</h3><p>Some text <a href="/x${i}">link</a></p><span class="meta">m</span></div>`;
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); }).listen(PORT);

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

const run = async (withExt) => {
  const args = [`--host-resolver-rules=MAP * 127.0.0.1:${PORT}`, '--no-proxy-server'];
  if (withExt) args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'bench-')), { headless: true, channel: 'chromium', args });
  if (withExt) { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); await new Promise((r) => setTimeout(r, 1500)); }
  const load = [], recalc = [];
  for (let i = 0; i < 8; i++) {
    const p = await ctx.newPage();
    await p.goto(`http://site${i}.example/`, { waitUntil: 'load' });
    await p.waitForTimeout(300);
    recalc.push(await p.evaluate(() => {
      const t0 = performance.now();
      for (const el of document.querySelectorAll('div')) el.className += ' y';
      document.body.offsetHeight; // force style + layout
      return performance.now() - t0;
    }));
    load.push(await p.evaluate(() => performance.getEntriesByType('navigation')[0].loadEventEnd));
    await p.close();
  }
  await ctx.close();
  return { loadMs: +median(load).toFixed(1), restyleMs: +median(recalc).toFixed(1) };
};

const base = await run(false);
const ext = await run(true);
console.log('Without extension:', base);
console.log('With extension:   ', ext);
console.log(`Overhead: load +${(ext.loadMs - base.loadMs).toFixed(1)} ms, restyle +${(ext.restyleMs - base.restyleMs).toFixed(1)} ms`);
server.close();
