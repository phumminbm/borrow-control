// =============================================================================
// helpers.js — Utility functions for the Mobile BR Return module
//
// Shared by RequestReturnSheet, ReturnsScreen, and the parent MobileApp.
// Pure functions — no React, no side effects, no API calls.
// =============================================================================

// ── ID generator ─────────────────────────────────────────────────────────────
// Production format: RT-YYYYMMDDhhmmss-RR  (no "T-" test prefix)
// Two random hex chars at the end prevent same-second collisions from
// concurrent submissions on multiple devices.
//
// NOTE: In Test Mode (isTest: true), the Desktop BR Return uses prefix "RT-T-".
// The production mobile path sets isTest: false, so the prefix is just "RT-".
// This function is for PRODUCTION submissions only. If you ever add a test-mode
// toggle to the mobile UI, keep the "RT-T-" prefix logic in the caller, not here.
export function genReturnId() {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");
  const hh   = String(now.getHours()).padStart(2, "0");
  const mi   = String(now.getMinutes()).padStart(2, "0");
  const ss   = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return `RT-${yyyy}${mm}${dd}${hh}${mi}${ss}-${rand}`;
}

// ── Date helpers ─────────────────────────────────────────────────────────────
// Read the active language from localStorage at call-time so date helpers
// switch the moment the user flips the TH/EN toggle.
function _activeLang() {
  try { return localStorage.getItem("lang") || "th"; }
  catch { return "th"; }
}

export function fmtDate(d, lang) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const loc = (lang || _activeLang()) === "en" ? "en-GB" : "th-TH";
  return dt.toLocaleDateString(loc, { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d, lang) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const loc = (lang || _activeLang()) === "en" ? "en-GB" : "th-TH";
  return dt.toLocaleString(loc, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", year: "numeric" });
}

// ── Calendar helpers (used by date-range picker in ReturnsScreen) ───────────
export const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const EN_MONTHS_SHORT   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const THAI_DAY_HEADERS  = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
export const EN_DAY_HEADERS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const THAI_DAY_FULL     = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
export const EN_DAY_FULL       = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

export function fmtDayMonth(d, lang) {
  if (!d) return "";
  const day = (lang === "th" ? THAI_DAY_FULL : EN_DAY_FULL)[d.getDay()];
  const mon = (lang === "th" ? THAI_MONTHS_SHORT : EN_MONTHS_SHORT)[d.getMonth()];
  return `${day} ${d.getDate()} ${mon}`;
}

export function fmtShortDate(d, lang) {
  if (!d) return "";
  const mon = (lang === "th" ? THAI_MONTHS_SHORT : EN_MONTHS_SHORT)[d.getMonth()];
  return `${d.getDate()} ${mon}`;
}

// Buddhist-year date sort key: BBBBMMDD (fits in INT4, sorts by date).
// CRITICAL: using Date.now() (~1.7e12) overflows Postgres INT4 max (2.1e9).
// This matches the date_sort column format used by Desktop BR Return.
export function todayDateSort() {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  return buddhistYear * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

// ── Image helpers ─────────────────────────────────────────────────────────────
// Compresses a File to a base64 data-URL at a target max dimension/quality.
// Used by RequestReturnSheet to keep photo payloads under ~100KB each.
// Returns a promise resolving to the compressed data-URL string.
export function compressImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1000;
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) { height = Math.round((height / width) * MAX_DIM); width = MAX_DIM; }
          else                { width  = Math.round((width  / height) * MAX_DIM); height = MAX_DIM; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Rough byte estimate for a single attachment record.
// Used to warn user before payload grows too large.
export function approxAttachmentBytes(att) {
  if (!att) return 0;
  const dataLen = att.data ? att.data.length * 0.75 : 0;
  return dataLen + (att.name ? att.name.length : 0) + 20;
}
