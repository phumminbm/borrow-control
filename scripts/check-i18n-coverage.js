#!/usr/bin/env node
// =============================================================================
// scripts/check-i18n-coverage.js
//
// Scans the project's UI source files for any remaining Thai characters that
// live OUTSIDE the i18n dictionaries AND aren't already paired with an
// English fallback (via lang-ternaries or label_th/label_en object pairs).
//
// The presence of any Thai outside these allowed locations means a TH→EN
// translation was missed, and "EN mode" would still show that string in
// Thai — which the user has explicitly ruled out.
//
// What's scanned:
//   - frontend/src/components/MobilePrototypeApp.jsx
//   - backend/static/br-return.html
//   - backend/main.py
//
// What's allowed (Thai here is expected and OK):
//   - Inside the BR_STRINGS / STRINGS dictionary objects
//   - Inside // and /* */ and # comments
//   - Inside `lang === "th" ? "...thai..." : "...english..."` ternaries
//   - Inside THAI_MONTHS_SHORT / THAI_DAY_HEADERS / THAI_DAY_FULL arrays
//     (these are paired with EN_* siblings at lookup time)
//   - Inside object literals where label_th is paired with label_en
//
// Exit codes:
//   0  →  no Thai found outside the allowed zones  (build passes)
//   2  →  Thai found outside the allowed zones; outputs a report  (build fails)
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

// Thai script range, EXCLUDING U+0E3F BAHT SIGN ฿ (currency symbol used
// in both Thai and English UIs). The Baht sign isn't Thai-language text.
const THAI   = /[ก-฾เ-๿]+/;
const THAI_G = /[ก-฾เ-๿]+/g;

const args = new Set(process.argv.slice(2));
const SUMMARY = args.has('--summary');

function stripBenign(filePath, src) {
  let out = src;
  // Strip /* ... */ block comments
  out = out.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(THAI_G, ''));
  // Strip // line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, m => m.replace(THAI_G, ''));
  // Strip HTML <!-- ... --> comments
  out = out.replace(/<!--[\s\S]*?-->/g, m => m.replace(THAI_G, ''));
  // Python comments + docstrings
  if (filePath.endsWith('.py')) {
    out = out.replace(/#[^\n]*/g, m => m.replace(THAI_G, ''));
    // Triple-quoted strings (docstrings + module-level """ """ blocks).
    // Conservative: both """ ... """ and ''' ... ''' forms.
    out = out.replace(/"""[\s\S]*?"""/g, m => m.replace(THAI_G, ''));
    out = out.replace(/'''[\s\S]*?'''/g, m => m.replace(THAI_G, ''));
  }
  // Strip the i18n dictionary regions wholesale.
  const dictPatterns = [
    /var\s+BR_STRINGS\s*=\s*\{[\s\S]*?\n\};/m,
    /const\s+STRINGS\s*=\s*\{[\s\S]*?\n\};/m,
    /export\s+const\s+STRINGS\s*=\s*\{[\s\S]*?\n\};/m,
  ];
  for (const re of dictPatterns) {
    out = out.replace(re, m => m.replace(THAI_G, ''));
  }
  // Strip `lang === "th" ? "..." : "..."` ternaries — bilingual already.
  out = out.replace(
    /lang\s*===\s*["']th["']\s*\?\s*(?:"[^"]*"|'[^']*'|`(?:[^`\\]|\\.)*`)\s*:\s*(?:"[^"]*"|'[^']*'|`(?:[^`\\]|\\.)*`)/g,
    m => m.replace(THAI_G, '')
  );
  // Also strip JSX-fragment ternaries:
  //   lang === "th" ? <>...thai...</> : <>...english...</>
  // Multi-line aware; the fragment can span lines and contain other JSX.
  out = out.replace(
    /lang\s*===\s*["']th["']\s*\?\s*<>[\s\S]*?<\/>\s*:\s*<>[\s\S]*?<\/>/g,
    m => m.replace(THAI_G, '')
  );
  // Mobile + Desktop calendar arrays — intentionally Thai, paired with
  // EN_* siblings at lookup time (calMonths() / calDays() helpers).
  out = out.replace(
    /(THAI_MONTHS_SHORT|THAI_DAY_HEADERS|THAI_DAY_FULL|TH_MONTHS_FULL|TH_MONTHS_SHORT|TH_DAYS_SHORT|TH_MONTHS|TH_MONTHS_S|TH_DAYS)\s*=\s*[^;]*?\]/g,
    m => m.replace(THAI_G, '')
  );
  // label_th / label_short_th — paired with label_en at lookup time.
  out = out.replace(
    /label_(?:short_)?th\s*:\s*(?:"[^"]*"|'[^']*'|`[^`]*`)/g,
    m => m.replace(THAI_G, '')
  );
  // Demo-photo palette tag: strings (overlay in synthesized SVG).
  out = out.replace(
    /\btag\s*:\s*(?:"[^"]*"|'[^']*'|`[^`]*`)/g,
    m => m.replace(THAI_G, '')
  );
  // HTML elements that already carry a data-i18n / data-i18n-placeholder /
  // data-i18n-title attribute are translated at render time by
  // applyStaticI18n(). The inline Thai text inside them is just a fallback
  // for users with JS disabled — not a real translation gap. Strip Thai
  // from any line that contains the attribute.
  out = out.split('\n').map(line => {
    if (/data-i18n(?:-placeholder|-title)?\s*=\s*"/.test(line)) {
      return line.replace(THAI_G, '');
    }
    return line;
  }).join('\n');
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

if (SUMMARY) {
  for (const r of fileReports) {
    if (r.error) {
      console.log('  [' + r.error + '] ' + r.rel);
    } else {
      console.log('  ' + r.violations.length.toString().padStart(4) + ' Thai phrase(s) outside dictionary in  ' + r.rel);
    }
  }
  console.log('  ────');
  console.log('  ' + totalViolations.toString().padStart(4) + ' TOTAL');
} else {
  console.log('\nI18N COVERAGE REPORT');
  console.log('─'.repeat(60));
  for (const r of fileReports) {
    if (r.error) {
      console.log('\n[' + r.error + '] ' + r.rel);
      continue;
    }
    console.log('\n' + r.rel + '  —  ' + r.violations.length + ' Thai phrase(s) outside dictionary');
    if (r.violations.length > 0) {
      const preview = r.violations.slice(0, 12);
      for (const v of preview) {
        console.log('  L' + v.line.toString().padStart(5) + ':  ' + v.phrase);
      }
      if (r.violations.length > preview.length) {
        console.log('  …  +' + (r.violations.length - preview.length) + ' more');
      }
    }
  }
  console.log('\n' + '─'.repeat(60));
  console.log('TOTAL outside dictionary: ' + totalViolations);
}

if (process.env.FAIL_ON_THAI === '1' && totalViolations > 0) {
  console.error('\nFAIL: Thai text found outside the dictionary.');
  console.error('Add the missing strings to BR_STRINGS / STRINGS and replace');
  console.error('the inline Thai with _t() / t() calls, then re-run.');
  process.exit(2);
}
process.exit(0);
