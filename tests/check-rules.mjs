// Validates the compiled filter files inside real Chromium and (with --fix) removes anything
// Chrome would reject: regex rules over Chrome's RE2 memory limit and CSS selectors Chrome can't
// parse. build-filters.mjs runs this automatically when Playwright is installed in tests/.
//
//   node check-rules.mjs          report only
//   node check-rules.mjs --fix    rewrite rulesets/*.json and filters/cosmetic.json

import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULESETS = ['easylist', 'easyprivacy', 'custom'];

export const validate = async ({ fix = false } = {}) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pab-check-')), {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const sets = Object.fromEntries(RULESETS.map((id) => [id, JSON.parse(readFileSync(join(EXT, 'rulesets', id + '.json'), 'utf8'))]));
    const regexes = Object.entries(sets).flatMap(([id, rules]) => rules.filter((r) => r.condition.regexFilter)
      .map((r) => ({ id, ruleId: r.id, regex: r.condition.regexFilter, isCaseSensitive: !!r.condition.isUrlFilterCaseSensitive })));
    const badRegex = await sw.evaluate(async (list) => {
      const bad = [];
      for (const x of list) {
        const r = await chrome.declarativeNetRequest.isRegexSupported({ regex: x.regex, isCaseSensitive: x.isCaseSensitive });
        if (!r.isSupported) bad.push({ ...x, reason: r.reason });
      }
      return bad;
    }, regexes);

    const cos = JSON.parse(readFileSync(join(EXT, 'filters/cosmetic.json'), 'utf8'));
    const all = [...new Set([...cos.generic, ...Object.values(cos.hide).flat()])];
    const page = await ctx.newPage();
    await page.setContent('<p></p>');
    const badSel = new Set(await page.evaluate((list) => list.filter((s) => {
      try { document.querySelector(s); return false; } catch { return true; }
    }), all));

    console.log(`Chrome check: ${regexes.length - badRegex.length}/${regexes.length} regex rules OK, ${all.length - badSel.size}/${all.length} selectors OK`);

    if (fix && (badRegex.length || badSel.size)) {
      for (const id of RULESETS) {
        const drop = new Set(badRegex.filter((b) => b.id === id).map((b) => b.ruleId));
        if (!drop.size) continue;
        const kept = sets[id].filter((r) => !drop.has(r.id)).map((r, i) => ({ ...r, id: i + 1 }));
        writeFileSync(join(EXT, 'rulesets', id + '.json'), JSON.stringify(kept));
      }
      cos.generic = cos.generic.filter((s) => !badSel.has(s));
      for (const k of Object.keys(cos.hide)) cos.hide[k] = cos.hide[k].filter((s) => !badSel.has(s));
      writeFileSync(join(EXT, 'filters/cosmetic.json'), JSON.stringify(cos));
      console.log(`Removed ${badRegex.length} regex rules and ${badSel.size} selectors that Chrome rejects.`);
    }
    return { badRegex, badSelectors: [...badSel] };
  } finally {
    await ctx.close();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validate({ fix: process.argv.includes('--fix') });
}
