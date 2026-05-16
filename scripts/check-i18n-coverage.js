#!/usr/bin/env node
// =============================================================================
// scripts/check-i18n-coverage.js
//
// Scans the project's UI source files for any remaining Thai characters that
// live OUTSIDE the i18n dictionaries. The presence of any Thai outside the
// dictionary means a TH→EN translation was missed, and "EN mode" would still
// show that string in Thai — which the user has explicitly ruled out.
//
// What's scanned:
//   - frontend/src/components/MobilePrototypeApp.jsx
//   - backend/static/br-return.html
//   - backend/main.py
//
// What's whitelisted (Thai text here is expected and OK):
//   - Inside the BR_STRINGS object in br-return.html (the dictionary itself)
//   - Inside STRINGS / Mobile dictionary entries
//   - Inside // and /* */ and # comments
//   - Inside string template values mapped via _t()
//
// Exit codes:
//   0  →  no Thai found outside the dictionary  (build passes)
//   2  →  Thai found outside the dictionary; outputs a report  (build fails)
//
// Run via:  node scripts/check-i18n-coverage.js
// Or:       node scripts/check-i18n-coverage.js --summary    (counts only)
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  'frontend/src/components/MobilePrototypeApp.jsx',
  'backend/static/br-return.html',
  'backend/main.py',
];

// Thai script Unicode range: U+0E00 through U+0E7F
const THAI = /[฀-๿]+/;
const THAI_G = /[฀-๿]+/g;

const args = new Set(process.argv.slice(2));
const SUMMARY = args.has('--summary');

// Strip line comments and block comments + dictionary regions so we don't
// flag Thai that's legitimately inside them. This is intentionally
// conservative — it would rather miss a real violation than false-positive
// on legitimate dictionary content.
function stripBenign(filePath, src) {
  let out = src;
  // Strip /* ... */ block comments
  out = out.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(THAI_G, ''));
  // Strip // line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, m => m.replace(THAI_G, ''));
  // Strip Python # line comments
  if (filePath.endsWith('.py')) {
    out = out.replace(/#[^\n]*/g, m => m.replace(THAI_G, ''));
  }
  // Strip the i18n dictionary regions wholesale. We bracket-match the
  // BR_STRINGS object in HTML and STRINGS object in JSX.
  const dictPatterns = [
    /var\s+BR_STRINGS\s*=\s*\{[\s\S]*?\n\};/m,
    /const\s+STRINGS\s*=\s*\{[\s\S]*?\n\};/m,
    /export\s+const\s+STRINGS\s*=\s*\{[\s\S]*?\n\};/m,
  ];
  for (const re of dictPatterns) {
    out = out.replace(re, m => m.replace(THAI_G, ''));
  }
  return out;
}

let totalViolations = 0;
const fileReports = [];

for (const rel of TARGETS) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    fileReports.push({ rel, error: 'missing' });
    continue;
  }
  const src = fs.readFileSync(full, 'utf8');
  const stripped = stripBenign(rel, src);
  const violations = [];
  stripped.split('\n').forEach((line, i) => {
    const m = line.match(THAI_G);
    if (m) {
      m.forEach(hit => violations.push({ line: i + 1, phrase: hit }));
    }
  });
  totalViolations += violations.length;
  fileReports.push({ rel, violations });
}

// Report
if (SUMMARY) {
  for (const r of fileReports) {
    if (r.error) {
      console.log(`  [${r.error}] ${r.rel}`);
    } else {
      console.log(`  ${r.violations.length.toString().padStart(4)} Thai phrase(s) outside dictionary in  ${r.rel}`);
    }
  }
  console.log(`  ────`);
  console.log(`  ${totalViolations.toString().padStart(4)} TOTAL`);
} else {
  console.log('\nI18N COVERAGE REPORT');
  console.log('────────────────────────────────────────────────────────────');
  for (const r of fileReports) {
    if (r.error) {
      console.log(`\n[${r.error}] ${r.rel}`);
      continue;
    }
    console.log(`\n${r.rel}  —  ${r.violations.length} Thai phrase(s) outside dictionary`);
    if (r.violations.length > 0) {
      const preview = r.violations.slice(0, 12);
      for (const v of preview) {
        console.log(`  L${v.line.toString().padStart(5)}:  ${v.phrase}`);
      }
      if (r.violations.length > preview.length) {
        console.log(`  …  +${r.violations.length - preview.length} more`);
      }
    }
  }
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`TOTAL outside dictionary: ${totalViolations}`);
}

// During phase 1 (dictionary skeleton), the count is expected to be > 0
// because most Thai strings haven't been migrated to the dictionary yet.
// The script always reports; it only EXITS non-zero when the env var
// FAIL_ON_THAI=1 is set, so CI gating is opt-in once we reach phase 3.
if (process.env.FAIL_ON_THAI === '1' && totalViolations > 0) {
  console.error('\nFAIL: Thai text found outside the dictionary.');
  console.error('Add the missing strings to BR_STRINGS / STRINGS and replace');
  console.error('the inline Thai with _t() / t() calls, then re-run.');
  process.exit(2);
}
process.exit(0);
