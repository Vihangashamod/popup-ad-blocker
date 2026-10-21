#!/usr/bin/env node
// Compiles EasyList + EasyPrivacy (+ our own custom filters) into the files the extension ships:
//
//   rulesets/easylist.json      static declarativeNetRequest rules (ads)
//   rulesets/easyprivacy.json   static declarativeNetRequest rules (trackers)
//   rulesets/custom.json        our own rules: legacy rules.json + tools/custom-filters.txt
//   filters/cosmetic.json       element-hiding data (generic selectors + per-site selectors)
//   filters/meta.json           counts and build date, shown in the popup
//
// Usage:  cd tools && npm install --ignore-scripts && npm run build
//
// The lists are fetched from the EasyList GitHub repository using its own templates, so the
// set of included files always matches what EasyList itself publishes.

import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseSelector } from 'css-what';

const require = createRequire(import.meta.url);
const { createConverter } = require('@eyeo/webext-ad-filtering-solution/adblockpluscore/lib/dnr/index.js');
const { Filter } = require('@eyeo/webext-ad-filtering-solution/adblockpluscore/lib/filterClasses.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RAW = 'https://raw.githubusercontent.com/easylist/easylist/master/';

// Chrome limits. Static rulesets: 30,000 rules are guaranteed per extension, more come from a
// shared global pool. Regex rules: at most 1,000 per ruleset.
const MAX_REGEX_PER_RULESET = 1000;
const MAX_RULES_PER_RULESET = 150000;

const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'media', 'websocket', 'webtransport', 'other'];

// --------------------------------------------------------------------------------------------
// Fetching
// --------------------------------------------------------------------------------------------

const fetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};

// Expands "%include easylist:path%" lines from an EasyList template.
const fetchTemplate = async (name) => {
  const tpl = await fetchText(RAW + name);
  const parts = [...tpl.matchAll(/^%include easylist:(.+?)%$/gm)].map((m) => m[1])
    .filter((p) => p.endsWith('.txt') && p !== 'template_header.txt');
  const texts = await Promise.all(parts.map((p) => fetchText(RAW + p)));
  console.log(`  ${name}: ${parts.length} files`);
  return texts.join('\n').split(/\r?\n/);
};

// --------------------------------------------------------------------------------------------
// Network filters -> DNR
// --------------------------------------------------------------------------------------------

// Node can't run Chrome's RE2 check, so approximate it: valid JS regex, no look-around or
// back-references (RE2 has neither), and short enough to stay under Chrome's 2KB compiled limit.
const regexOk = (re) => {
  if (re.length > 300) return false;
  if (/\(\?[=!<]|\\[1-9]/.test(re)) return false;
  try { new RegExp(re); return true; } catch { return false; }
};

const converter = createConverter({ isRegexSupported: ({ regex }) => regexOk(regex) });

// "$popup" filters can't be expressed in DNR as written (DNR doesn't know which tab opened a
// page). The domains in them are pop-up ad servers, so block them as top-level pages opened
// from another site instead.
const popupRule = (line) => {
  const m = line.match(/^\|\|([a-z0-9.-]+)\^?\$popup(?:,third-party|,3p)?$/i);
  if (!m) return null;
  return {
    priority: 1000,
    action: { type: 'block' },
    condition: { requestDomains: [m[1].toLowerCase()], domainType: 'thirdParty', resourceTypes: ['main_frame', 'sub_frame'] },
  };
};

const isNetworkFilter = (l) => l && !l.startsWith('!') && !l.startsWith('[') && !/#[@?$%]?#|#\+js|##\^/.test(l);

const convertNetwork = async (lines, label) => {
  const rules = [];
  let skipped = 0;
  let regexCount = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!isNetworkFilter(line)) continue;
    if (/\$(.*,)?popup\b/.test(line)) {
      const r = popupRule(line);
      r ? rules.push(r) : skipped++;
      continue;
    }
    let out;
    try { out = await converter(Filter.normalize(line)); } catch { skipped++; continue; }
    if (!Array.isArray(out) || !out.length) { skipped++; continue; }
    for (const r of out) {
      if (r.condition?.regexFilter) {
        if (regexCount >= MAX_REGEX_PER_RULESET) { skipped++; continue; }
        regexCount++;
      }
      // Drop rule types we don't want shipping in a general blocker (header rewriting, redirects
      // to resources we don't bundle).
      if (!['block', 'allow', 'allowAllRequests', 'upgradeScheme'].includes(r.action.type)) { skipped++; continue; }
      rules.push(r);
    }
  }
  const packed = packDomainRules(rules);
  const final = packed.slice(0, MAX_RULES_PER_RULESET).map((r, i) => ({ ...r, id: i + 1 }));
  console.log(`  ${label}: ${rules.length} filters -> ${final.length} rules (${regexCount} regex), ${skipped} skipped`);
  final.filterCount = rules.length; // not serialised; read by main() for meta.json
  return final;
};

// Most list entries are plain "||domain^" blocks. Chrome counts a rule with 1,000
// requestDomains as ONE rule, so grouping them keeps us far under the rule limits and makes
// matching faster. Only rules that differ in nothing but the domain are grouped.
const DOMAINS_PER_PACKED_RULE = 1000;
const packDomainRules = (rules) => {
  const groups = new Map();
  const rest = [];
  for (const r of rules) {
    const { urlFilter, ...cond } = r.condition;
    const m = urlFilter && urlFilter.match(/^\|\|([a-z0-9.-]+)\^$/);
    if (!m || cond.requestDomains || cond.excludedRequestDomains) { rest.push(r); continue; }
    const key = JSON.stringify([r.priority, r.action, cond]);
    if (!groups.has(key)) groups.set(key, { base: r, cond, domains: new Set() });
    groups.get(key).domains.add(m[1]);
  }
  for (const { base, cond, domains } of groups.values()) {
    const list = [...domains].sort();
    for (let i = 0; i < list.length; i += DOMAINS_PER_PACKED_RULE) {
      rest.push({ priority: base.priority, action: base.action,
        condition: { ...cond, requestDomains: list.slice(i, i + DOMAINS_PER_PACKED_RULE) } });
    }
  }
  return rest;
};

// --------------------------------------------------------------------------------------------
// Cosmetic filters
// --------------------------------------------------------------------------------------------

// Extended (non-CSS) syntax from ABP/uBO/AdGuard that a stylesheet can't express.
const EXTENDED = /:(-abp-|has-text|contains|xpath|upward|remove|style|matches-|min-text-length|watch-attr|others|if|if-not|nth-ancestor|properties|remove-attr|remove-class)\b|\[-ext-/;

const validSelector = (sel) => {
  if (!sel || sel.length > 1000 || EXTENDED.test(sel)) return false;
  try { parseSelector(sel); return true; } catch { return false; }
};

const parseCosmetic = (lines) => {
  const generic = new Set();
  const hide = {};          // domain -> Set(selectors)
  const unhide = {};        // domain -> Set(selectors) excluded on that domain
  const genericHide = new Set(); // domains where generic hiding is switched off
  const add = (map, d, s) => (map[d] ||= new Set()).add(s);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('!')) continue;

    // @@||example.com^$generichide / $elemhide
    const gh = line.match(/^@@\|\|([a-z0-9.-]+)\^?\$(?:.*,)?(generichide|elemhide|ghide|ehide)\b/i);
    if (gh) { genericHide.add(gh[1].toLowerCase()); continue; }

    const m = line.match(/^([^#]*)#(@?)#(.+)$/);
    if (!m) continue;
    const [, domainPart, isException, selector] = m;
    if (selector.startsWith('+js') || selector.startsWith('^') || !validSelector(selector)) continue;

    const domains = domainPart ? domainPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
    const include = domains.filter((d) => !d.startsWith('~'));
    const exclude = domains.filter((d) => d.startsWith('~')).map((d) => d.slice(1));

    if (isException) {
      if (!include.length) continue; // generic exceptions are rare; ignore
      include.forEach((d) => add(unhide, d, selector));
    } else if (!include.length) {
      generic.add(selector);
      exclude.forEach((d) => add(unhide, d, selector));
    } else {
      include.forEach((d) => add(hide, d, selector));
      exclude.forEach((d) => add(unhide, d, selector));
    }
  }

  const toObj = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
  return { generic: [...generic], hide: toObj(hide), unhide: toObj(unhide), genericHide: [...genericHide] };
};

const mergeCosmetic = (a, b) => {
  const merge = (x, y) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = [...new Set([...(out[k] || []), ...v])];
    return out;
  };
  return {
    generic: [...new Set([...a.generic, ...b.generic])],
    hide: merge(a.hide, b.hide),
    unhide: merge(a.unhide, b.unhide),
    genericHide: [...new Set([...a.genericHide, ...b.genericHide])],
  };
};

// --------------------------------------------------------------------------------------------
// Build
// --------------------------------------------------------------------------------------------

const main = async () => {
  console.log('Fetching lists from github.com/easylist/easylist ...');
  const [easylist, easyprivacy] = await Promise.all([
    fetchTemplate('easylist.template'),
    fetchTemplate('easyprivacy.template'),
  ]);
  const custom = (await readFile(join(HERE, 'custom-filters.txt'), 'utf8')).split(/\r?\n/);

  console.log('Converting network filters ...');
  const elRules = await convertNetwork(easylist, 'easylist');
  const epRules = await convertNetwork(easyprivacy, 'easyprivacy');

  // Custom ruleset = the hand-written rules from v2 (rules.json) + tools/custom-filters.txt
  const legacy = JSON.parse(await readFile(join(HERE, 'legacy-rules.json'), 'utf8'))
    .map(({ id, ...r }) => ({ priority: 1000, ...r }));
  const customRules = [...legacy, ...(await convertNetwork(custom, 'custom-filters.txt'))]
    .map(({ id, ...r }, i) => ({ ...r, id: i + 1 }));

  console.log('Parsing cosmetic filters ...');
  const cosmetic = mergeCosmetic(parseCosmetic(easylist), parseCosmetic(custom));
  console.log(`  ${cosmetic.generic.length} generic selectors, ${Object.keys(cosmetic.hide).length} sites with specific rules`);

  await mkdir(join(ROOT, 'rulesets'), { recursive: true });
  await mkdir(join(ROOT, 'filters'), { recursive: true });
  const write = (p, data) => writeFile(join(ROOT, p), JSON.stringify(data));
  await write('rulesets/easylist.json', elRules);
  await write('rulesets/easyprivacy.json', epRules);
  await write('rulesets/custom.json', customRules);
  await write('filters/cosmetic.json', cosmetic);
  await writeFile(join(ROOT, 'filters/meta.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    rulesets: {
      easylist: { rules: elRules.length, filters: elRules.filterCount },
      easyprivacy: { rules: epRules.length, filters: epRules.filterCount },
      custom: { rules: customRules.length, filters: customRules.length },
    },
    cosmetic: { generic: cosmetic.generic.length, sites: Object.keys(cosmetic.hide).length },
  }, null, 2));
  // Let real Chromium weed out anything it would reject (needs `npm install` in tests/).
  try {
    const { validate } = await import('../tests/check-rules.mjs');
    await validate({ fix: true });
    // meta counts stay as written above: they describe the filters, not Chrome's rule objects
  } catch (e) {
    console.log('Skipped Chrome validation (run `npm install` in tests/ to enable):', e.code || e.message);
  }
  console.log('Done.');
};

main().catch((e) => { console.error(e); process.exit(1); });
