// =============================================================================
// MobilePrototypeApp — Sale-side BR Return flow (connected-test mode)
//
// SAFETY INVARIANTS (do not violate without explicit user approval):
//   1. This file is TEST-ONLY. Activated via `?prototype=1` URL flag
//      (legacy alias: `?test=1`). The bare URL serves the real
//      MobileApp untouched.
//   2. Reads real data from production endpoints (read-only): /customers,
//      /customers/{cc}/brs, /sync-logs, /analytics/customer-value.
//   3. Writes return requests to /return-requests with isTest=true.
//      The backend filters these OUT of the production Admin queue by
//      default — they're visible only when Desktop Admin toggles
//      🧪 TEST mode ON. Cleanup is a single SQL:
//         DELETE FROM return_requests WHERE is_test = TRUE
//   4. The Apps Script Sheet writeback is BLOCKED for isTest=true rows
//      via two independent guards: Desktop frontend skip + backend
//      force-set sheet_sync='skipped-test'. The real Logistics File
//      is never touched by anything this file submits.
//   5. RT IDs use prefix "RT-T-" so test IDs are visually distinct
//      from production RT-* IDs even when both queues are viewed
//      side-by-side.
//   6. Status taxonomy matches Desktop BR Return exactly:
//      pending / approved / rejected / cancelled
//      (Thai: รอตรวจสอบคำขอ / อนุมัติแล้ว / แก้ไขคำขอ / ยกเลิกแล้ว)
//
// HISTORY:
//   - Before 2026-05-16: this file supported two parallel modes —
//     `?prototype=1` (localStorage-only, RT-P-*) for visual review and
//     `?test=1` (backend-connected, RT-T-*) for integration testing.
//     The two-mode setup caused reviewer confusion because the UIs
//     looked identical but the data lived in different places.
//   - 2026-05-16: collapsed to a single mode. `?prototype=1` and
//     `?test=1` both now activate the same backend-connected flow.
//     Legacy localStorage RT-P-* records are cleared on first boot
//     via a sentinel-gated `clearLegacyPrototypeStorage()`.
//
// This file copies (rather than imports) shared components from MobileApp.jsx
// on purpose — to preserve isolation. Changes here do not ripple to the real
// mobile app, and changes to the real mobile app do not bleed into the
// prototype. When the prototype is promoted (or discarded), no cleanup needed.
// =============================================================================
//
// INTEGRATION READINESS CHECKLIST (for whoever ships this to production)
// =============================================================================
// Goal of integration: backport the BR Return additions into the real
// MobileApp.jsx without dropping any existing feature. Do NOT replace
// MobileApp.jsx wholesale.
//
// (A) THINGS TO ADD INTO MobileApp.jsx (additive, in this order):
//     1. Constants: STATUS_META, RETURN_TYPES, genReturnId helper
//        (rename PROTO_* keys, drop the "RT-P-" prefix, drop _prototype flag)
//     2. Components: ReturnStatusPill, RevisionChip, RequestReturnSheet
//        (incl. editingRequest path), ReturnsScreen, ImageLightbox.
//        Lift them verbatim from this file, drop any "Prototype" badges.
//     3. New "returns" entry in the bottom-tab `tabs` array
//     4. New "ขอคืนสินค้า" CTA button in the BR Detail header (inside
//        CustomerDetailSheet, next to the Back button)
//     5. Optional: a "Quick Action" tile on Home linking to the returns tab
//     6. Edit-and-resubmit CTA on the Return Detail sheet for rejected
//        requests (already wired here in ReturnsScreen). Backend POST to
//        the same /return-requests endpoint with the merged submittedItems
//        and cleared adminNote/rejectedItems/attachments — see Desktop
//        br-return.html:2960-2963 for parity reference.
//
// (B) THINGS TO PRESERVE in MobileApp.jsx after merge (parity audit):
//     - GET /brs/{borrow_no}/pdf  → single-BR PDF Export button (BR Detail)
//     - POST /export-pdf/bulk     → multi-BR bulk PDF Export (Customer Detail)
//     - BR list search + status filter (BLOCK/WARNING/NORMAL chips)
//     - Customer list search + status filter + sort options
//     - Alerts tab BLOCK/WARNING split
//     - Profile / Change Sale flow
//     - Donut chart + KPI grid + critical-customers preview on Home
//     - Status pill / Team pill styling exactly as today
//     - 4-min sync indicator + last-sync timestamp on Home + Profile
//
// (C) THINGS TO REMOVE before merge (prototype-only scaffolding):
//     - loadProtoReturns / saveProtoReturns / upsertProtoReturn /
//       replaceProtoReturn → replace with fetch('/return-requests') calls
//       (GET + POST). The Desktop already accepts the same payload shape
//       used by upsertProtoReturn / the Sale resubmit path.
//     - "RT-P-" prefix in genReturnId → drop prefix to align with desktop
//     - "_prototype: true" flag on submitted requests → remove
//     - PROTOTYPE badge component + all its render sites
//     - Long-press "Simulate Admin status" handler in ReturnsScreen → drop
//       entirely (real status comes from Admin Desktop)
//     - AdminFeedbackComposer component → drop entirely (real Admin
//       composes feedback on Desktop; Sale-side mobile only receives it)
//     - Demo-photo path (genDemoPhoto) → drop; the real picker remains
//     - revisionHistory field on requests → decide before merge:
//       (a) keep as a prototype-only convenience and let backend ignore
//       it, or (b) implement a real revisions table in the backend.
//       Either way, the Rev N chip is a UX-only display.
//     - Delete-request action in admin sim sheet → drop
//     - Separate localStorage cache key (PROTO_DATA_CACHE) → use the
//       existing MOBILE_DATA_CACHE
//
// (D) PRE-MERGE VERIFICATION:
//     - Diff MobileApp.jsx (current) vs MobileApp.jsx (after backport).
//       Expected: only "+" additive lines. Any "-" line is a regression
//       — investigate before merging.
//     - Test single-BR PDF export still works
//     - Test bulk PDF export still works
//     - Test return submission writes to real /return-requests endpoint
//       and shows up in Admin Desktop /br-return queue
//     - Confirm Admin can approve/reject/cancel and Sale sees the status
//
// (E) DO NOT merge without explicit user sign-off. Integration crosses the
//     boundary from read-only prototype into the real production write
//     path — the safety invariants at the top of this file STOP APPLYING
//     once the localStorage shim is replaced with a backend POST.
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { TEAMS, TEAM_COLORS } from "../App";
import { t as _t } from "../i18n";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const PROTO_DATA_CACHE  = "borrow-control:prototype-mobile-cache";
const PROTO_RETURNS_KEY_LEGACY = "borrow-control:prototype-mobile-returns";  // legacy localStorage key — cleared on boot
const TEST_RT_PREFIX    = "RT-T-";   // backend-connected test prefix (RT-P-* retired)

// ── Activation mode (single, simplified 2026-05-16) ────────────────────
// `?prototype=1` (legacy alias `?test=1`) drops the user into this
// MobilePrototypeApp. It is now a SINGLE connected-test mode — there is
// no separate localStorage-only branch anymore. Every submission goes to
// the real /return-requests endpoint with isTest=true so the request is:
//   - invisible from the production Admin queue (filtered out by default)
//   - visible only when Desktop Admin toggles 🧪 TEST mode ON
//   - blocked from Apps Script writeback (defense in depth at frontend
//     guard + backend force-set sheet_sync='skipped-test')
//   - cleanly removable via DELETE FROM return_requests WHERE is_test = TRUE
//
// The old `RT-P-*` localStorage-only path was retired because it caused
// confusion: two parallel UIs displaying different data, and reviewers
// couldn't tell which mode they were in. Now there is one mode.
function isPrototypeMode() {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get("prototype") === "1" || q.get("test") === "1";
  } catch { return false; }
}
// Backward-compat alias kept so existing call sites don't all need
// renaming. Both names return the same boolean.
function isTestMode() { return isPrototypeMode(); }
function isLocalPrototypeMode() { return false; }  // retired

// One-time cleanup of any leftover localStorage submissions from the
// pre-merge `RT-P-*` era. Runs once per browser per session — the
// sentinel prevents repeated removal calls. Read-only data caches
// (PROTO_DATA_CACHE for customers/BRs) are intentionally NOT cleared
// because they're still useful as a read-through cache for the new
// connected mode.
const LEGACY_CLEAR_SENTINEL = "borrow-control:prototype-legacy-cleared-v1";
function clearLegacyPrototypeStorage() {
  try {
    if (!localStorage.getItem(LEGACY_CLEAR_SENTINEL)) {
      localStorage.removeItem(PROTO_RETURNS_KEY_LEGACY);
      localStorage.setItem(LEGACY_CLEAR_SENTINEL, "1");
    }
  } catch {}
}

// ── localStorage helpers ──────────────────────────────────────────────
function readCache(key)  { try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch { return {}; } }
function writeCache(key, data) { try { localStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {} }

// ── Local cache of test-mode return requests ──────────────────────────
// In test mode we still keep a thin in-memory mirror of the backend list
// so the React tree has something to render between fetches. The mirror
// is reseeded from /return-requests?include_test=only on every poll +
// after every write. It is NEVER persisted to localStorage so the
// `?prototype=1` cache stays isolated.
let _TEST_CACHE = [];
function getTestCache()        { return _TEST_CACHE.slice(); }
function setTestCache(arr)     { _TEST_CACHE = Array.isArray(arr) ? arr : []; }
function upsertTestCacheLocal(req){
  const i = _TEST_CACHE.findIndex(r => r.id === req.id);
  if (i >= 0) _TEST_CACHE[i] = { ..._TEST_CACHE[i], ...req };
  else        _TEST_CACHE = [req, ..._TEST_CACHE];
}
function removeFromTestCacheLocal(id){
  _TEST_CACHE = _TEST_CACHE.filter(r => r.id !== id);
}

// Backend-shim helpers — used only in test mode (isTestMode() === true).
// They return Promises but the existing call sites are synchronous; for
// optimistic UI we update the in-memory cache first, then fire the POST
// in the background. Failures show a toast via window dispatch.
async function fetchTestReturnsFromBackend(){
  try {
    const res = await fetch(`${API_BASE}/return-requests?limit=2000&include_test=only`, { cache: "no-store" });
    if (!res.ok) throw new Error(`return-requests ${res.status}`);
    const arr = await res.json();
    setTestCache(Array.isArray(arr) ? arr : []);
    return getTestCache();
  } catch (err) {
    console.warn("[test-mode] fetch failed:", err);
    return getTestCache();
  }
}
async function postTestReturnToBackend(req){
  try {
    const res = await fetch(`${API_BASE}/return-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, isTest: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST /return-requests ${res.status} ${text.slice(0, 120)}`);
    }
    const data = await res.json().catch(() => null);
    if (data && data.request) {
      upsertTestCacheLocal(data.request);
      return data.request;
    }
    upsertTestCacheLocal(req);
    return req;
  } catch (err) {
    console.warn("[test-mode] POST failed:", err);
    throw err;
  }
}

// ── Return-request storage (single connected-test path, 2026-05-16) ───
// loadProtoReturns / saveProtoReturns are simple cache accessors.
// upsertProtoReturn / replaceProtoReturn each return a Promise that
// resolves with the persisted server-side row, or rejects with the
// backend error. The optimistic local entry is ROLLED BACK on rejection
// so the UI never shows a fake row from a request the backend refused.
// Call sites that want to show success only after persistence (the
// Sale-side submit flow, edit-and-resubmit) must `await` these.
function loadProtoReturns() {
  return getTestCache();
}
function saveProtoReturns(list) {
  setTestCache(list);
}
function upsertProtoReturn(req) {
  // Optimistic local insert for instant UI feedback…
  const beforeOptimistic = _TEST_CACHE.find(r => r.id === req.id) || null;
  upsertTestCacheLocal({ ...req, isTest: true });
  // …then return the backend promise. On rejection we roll back to
  // whatever the cache held before (or remove entirely if it was new)
  // so a failed submit never leaves a phantom row in the Returns tab.
  return postTestReturnToBackend(req).catch(err => {
    if (beforeOptimistic) upsertTestCacheLocal(beforeOptimistic);
    else                   removeFromTestCacheLocal(req.id);
    // Dispatch the i18n KEY rather than a literal Thai string so the
    // toast listener can render in the active language at receive-time.
    try { window.dispatchEvent(new CustomEvent("proto-test-error", { detail: { msgKey: "toast.backendPostFail" } })); } catch {}
    throw err;
  });
}

// In-place update of an existing return record by id. Used by:
//   1. The admin-feedback composer (apply rejection + per-item reasons +
//      attachments to the same record without changing its id).
//   2. The Sale-side "edit and resubmit" flow (replace submittedItems +
//      clear adminNote/rejectedItems/attachments, status → pending). This
//      mirrors the Desktop behavior at br-return.html:2960-2963 where the
//      same request id is preserved and rejection metadata is cleared.
// Returns a Promise that resolves with the updated row on backend success,
// or rejects with the backend error. The optimistic update is rolled back
// to the pre-call cache state on rejection.
function replaceProtoReturn(id, patch) {
  const cur = _TEST_CACHE.find(r => r.id === id);
  if (!cur) return Promise.resolve(null);
  const previousState = { ...cur };
  const next = { ...cur, ...patch, isTest: true };
  upsertTestCacheLocal(next);
  return postTestReturnToBackend(next).catch(err => {
    upsertTestCacheLocal(previousState);  // restore the row to what it was
    try { window.dispatchEvent(new CustomEvent("proto-test-error", { detail: { msgKey: "toast.backendUpdateFail" } })); } catch {}
    throw err;
  });
}

// ── Image helpers (prototype-only photo evidence in localStorage) ────
//
// Real photo path: <input type="file" accept="image/*" capture> → File ->
// canvas downscale to MAX_EDGE → base64 PNG. The Desktop equivalent stores
// the same {name, data, uploadedAt} shape in a JSONB column, so the data
// format here is forward-compatible with the existing schema. Stays
// physically inside localStorage — never POSTed anywhere.
//
// Demo photo path: synthesises a labeled SVG placeholder (no real file
// needed). Useful for demos where the reviewer doesn't have a real photo
// handy. The SVG is encoded into a data URL the same way a downscaled
// real photo would be, so the rest of the lightbox / thumbnail UI doesn't
// need to special-case it.
const PHOTO_MAX_EDGE = 600;          // px — keeps base64 well under 800 KB
const PHOTO_QUALITY  = 0.78;          // JPEG quality
const PHOTO_MAX_PER_REQUEST = 5;

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      reject(new Error("not an image"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        try {
          const ratio = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width  * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const data = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
          resolve({
            name: file.name || `photo-${Date.now()}.jpg`,
            data,
            uploadedAt: new Date().toISOString(),
            _demo: false,
          });
        } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function genDemoPhoto(idx) {
  // Hash-style picks so each generated photo looks visually different.
  // Inline SVG → encoded as a data URL so it slots into the same {data}
  // slot as a real compressed JPEG.
  const palettes = [
    { bg: "#1A2E0A", fg: "#C0DD97", tag: "✓ ตัวอย่างหลักฐาน" },
    { bg: "#3D2A00", fg: "#FAC775", tag: "⚠ ภาพประกอบ" },
    { bg: "#2a1815", fg: "#E89C7D", tag: "📷 รูปจำลอง" },
    { bg: "#2D0F1A", fg: "#D4357A", tag: "🔍 ตัวอย่าง" },
  ];
  const p = palettes[idx % palettes.length];
  const label = `Demo #${(idx % 99) + 1}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><rect width='400' height='300' fill='${p.bg}'/><circle cx='200' cy='130' r='52' fill='none' stroke='${p.fg}' stroke-width='6'/><path d='M178 130 l16 18 l30 -32' stroke='${p.fg}' stroke-width='8' fill='none' stroke-linecap='round' stroke-linejoin='round'/><text x='200' y='220' font-family='-apple-system,Inter,sans-serif' font-size='22' font-weight='700' fill='${p.fg}' text-anchor='middle'>${p.tag}</text><text x='200' y='252' font-family='ui-monospace,monospace' font-size='14' fill='${p.fg}' text-anchor='middle' opacity='0.7'>${label}</text></svg>`;
  const data = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  return {
    name: `demo-${Date.now()}.svg`,
    data,
    uploadedAt: new Date().toISOString(),
    _demo: true,
  };
}

// Approx storage size of a single attachment object — base64 strings are
// ~1.37× the raw byte count so this is a rough but useful budget signal.
function approxAttachmentBytes(att) {
  return (att && typeof att.data === "string") ? att.data.length : 0;
}

// ── ID generator ──────────────────────────────────────────────────────
// Single format now: RT-T-YYYYMMDDhhmmss-RR (timestamp-to-the-second
// plus 2 random hex chars). No client-side counter, so concurrent
// submissions from Mobile + a future Desktop test client cannot
// collide on a shared counter. The RT-T- prefix visually distinguishes
// test IDs from real RT-* production IDs even when both queues are
// viewed side-by-side.
function genProtoReturnId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");
  const hh   = String(now.getHours()).padStart(2, "0");
  const mi   = String(now.getMinutes()).padStart(2, "0");
  const ss   = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return `${TEST_RT_PREFIX}${yyyy}${mm}${dd}${hh}${mi}${ss}-${rand}`;
}

// ── HTTP fetch ────────────────────────────────────────────────────────
async function fetchJson(path, retries = 1) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return await res.json();
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 700));
      return fetchJson(path, retries - 1);
    }
    throw err;
  }
}

// ── Misc helpers ──────────────────────────────────────────────────────
function getTeam(sale) {
  for (const [t, s] of Object.entries(TEAMS)) if (s.includes(sale)) return t;
  return "Office";
}
function fmtVal(v) {
  if (!v) return "—";
  if (v >= 1000000) return `฿${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000)    return `฿${(v / 1000).toFixed(0)}K`;
  return `฿${Math.round(v).toLocaleString()}`;
}
function fmtFull(v) {
  if (!v) return "—";
  return `฿${Number(v).toLocaleString()}`;
}
// Read the active language from localStorage at call-time so date
// helpers switch the moment the user flips the TH/EN toggle.
function _activeLang() {
  try { return localStorage.getItem("lang") || "th"; }
  catch { return "th"; }
}
function fmtDate(d, lang) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const loc = (lang || _activeLang()) === "en" ? "en-GB" : "th-TH";
  return dt.toLocaleDateString(loc, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d, lang) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const loc = (lang || _activeLang()) === "en" ? "en-GB" : "th-TH";
  return dt.toLocaleString(loc, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", year: "numeric" });
}

// ── Calendar helpers (for the date-range picker on Returns tab) ──────
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS_SHORT   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const THAI_DAY_HEADERS  = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const EN_DAY_HEADERS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const THAI_DAY_FULL     = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
const EN_DAY_FULL       = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtDayMonth(d, lang) {
  if (!d) return "";
  const day = (lang === "th" ? THAI_DAY_FULL : EN_DAY_FULL)[d.getDay()];
  const mon = (lang === "th" ? THAI_MONTHS_SHORT : EN_MONTHS_SHORT)[d.getMonth()];
  return `${day} ${d.getDate()} ${mon}`;
}
function fmtShortDate(d, lang) {
  if (!d) return "";
  const mon = (lang === "th" ? THAI_MONTHS_SHORT : EN_MONTHS_SHORT)[d.getMonth()];
  return `${d.getDate()} ${mon}`;
}

// Match Desktop BR Return's dateSort format: Buddhist-year * 10000 +
// month*100 + day (e.g. 25690516 for 2026-05-16). Critical: the
// return_requests.date_sort column is Postgres INT4 with max value
// 2,147,483,647 — using Date.now() (~1.7e12) here overflows and the
// POST returns 500. Buddhist-yyyymmdd safely fits and sorts by date.
function todayDateSort() {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  return buddhistYear * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

// ── Status taxonomy — matches Desktop BR Return exactly ──────────────
// Colors aligned to MobileApp.jsx existing palette (BLOCK/WARNING/NORMAL family)
// for visual continuity with the rest of the mobile UI.
//   pending   → WARNING palette (amber/orange family)
//   approved  → NORMAL palette  (green family)
//   rejected  → soft peach (matches desktop convention for "needs revision")
//   cancelled → neutral gray harmonized with existing card borders
const STATUS_META = {
  pending:   { label_th: "รอตรวจสอบคำขอ", label_short_th: "รอตรวจสอบ", label_en: "Pending review", color: "#FAC775", bg: "#3D2A00", border: "#7A5500" },
  approved:  { label_th: "อนุมัติแล้ว",  label_short_th: "อนุมัติแล้ว", label_en: "Approved",       color: "#C0DD97", bg: "#1A2E0A", border: "#3A6014" },
  rejected:  { label_th: "แก้ไขคำขอ",    label_short_th: "แก้ไขคำขอ",  label_en: "Need revision",  color: "#E89C7D", bg: "#2a1815", border: "#6b3a26" },
  cancelled: { label_th: "ยกเลิกแล้ว",   label_short_th: "ยกเลิกแล้ว", label_en: "Cancelled",      color: "#aaa",    bg: "#1a1a1a", border: "rgba(255,255,255,0.1)" },
};

// Return type taxonomy (matches BR Return Apps Script). label_th and
// label_en are both provided so chips render in either language.
// Helpers below pick the right one based on the active language.
const RETURN_TYPES = [
  { key: "RETURN", label_th: "คืน",  label_en: "Return", icon: "↩", color: "#97C459", bg: "#1A2E0A", border: "#3A6014" },
  { key: "CLAIM",  label_th: "เคลม", label_en: "Claim",  icon: "⚠", color: "#FAC775", bg: "#3D2A00", border: "#7A5500" },
  { key: "SALE",   label_th: "ขาย",  label_en: "Sale",   icon: "💰", color: "#F09595", bg: "#3D1212", border: "#7A2020" },
  { key: "FREE",   label_th: "ฟรี",  label_en: "Free",   icon: "🎁", color: "#fff",    bg: "#1a1a1a", border: "#555" },
];

// Picks the right return-type label string given the active language.
// Tolerates objects that only have label_th (legacy data from older
// records) by falling through to the Thai label.
function typeLabel(t, lang) {
  if (!t) return "";
  if (lang === "en") return t.label_en || t.label_th || t.key || "";
  return t.label_th || t.label_en || t.key || "";
}

// Decompose a submittedItem into the list of types it actually uses
// (qty > 0). Each entry has { key, qty, label, color, icon }. Returns []
// when nothing is allocated. Used by Step 3 / Step 4 / Returns list /
// Returns detail to display multi-type items cleanly.
function breakdownFor(si) {
  const out = [];
  const KEYS = [
    ["RETURN", "retQty"],
    ["CLAIM",  "clmQty"],
    ["SALE",   "saleQty"],
    ["FREE",   "freeQty"],
  ];
  for (const [key, prop] of KEYS) {
    const q = Number(si[prop]) || 0;
    if (q > 0) {
      const t = RETURN_TYPES.find(r => r.key === key);
      out.push({ key, qty: q, label_th: t.label_th, label_en: t.label_en, color: t.color, icon: t.icon });
    }
  }
  return out;
}

// Stable identity for an item across revisions. Tolerates both
// Desktop-canonical (itemId/lineNo/lineKey) and Mobile-alias
// (item_id/line_no) shapes so it works on records written by either
// client.
function itemIdentity(it) {
  return it.itemId
      || it.item_id
      || it.lineKey
      || `${it.code || it.product_code || ""}-${it.lineNo || it.line_no || ""}`;
}

// Reconstruct the COMPLETE set of approved items for a fully-approved
// request that went through one or more correction rounds. After
// resubmit, current `submittedItems` contains only the items corrected
// in the latest revision; the original items that Admin approved in
// earlier rounds live in `revisionHistory[0].prevSubmittedItems`.
//
// Algorithm — iterate forward through history, overlay by item identity:
//   1. Seed from revisionHistory[0].prevSubmittedItems (the original
//      submission's full item list).
//   2. For each subsequent history entry, overlay its prevSubmittedItems
//      so any item that got corrected mid-flow uses the post-correction
//      version (a → a_v2 → a_v3 over time).
//   3. Finally overlay current `submittedItems` (the LATEST revision's
//      items, which are the post-correction versions for items the Sale
//      just re-touched).
//
// Items that were approved on the first round and never corrected stay
// at their original value (step 1) and pass through untouched. Items
// that went through one or more corrections end up with their newest
// version. The result is the full approved-state view the Sale needs.
function buildApprovedFullView(req) {
  const hist = Array.isArray(req.revisionHistory) ? req.revisionHistory : [];
  if (hist.length === 0) return Array.isArray(req.submittedItems) ? req.submittedItems : [];
  const byId = new Map();
  const original = Array.isArray(hist[0] && hist[0].prevSubmittedItems) ? hist[0].prevSubmittedItems : [];
  for (const it of original) byId.set(itemIdentity(it), it);
  for (let i = 1; i < hist.length; i++) {
    const items = Array.isArray(hist[i] && hist[i].prevSubmittedItems) ? hist[i].prevSubmittedItems : [];
    for (const it of items) byId.set(itemIdentity(it), it);
  }
  for (const it of (Array.isArray(req.submittedItems) ? req.submittedItems : [])) {
    byId.set(itemIdentity(it), it);
  }
  return Array.from(byId.values());
}

// =============================================================================
// SMALL UI COMPONENTS
// =============================================================================

function Icon({ name, size = 20, color = "currentColor" }) {
  const icons = {
    home:     <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>,
    users:    <><circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><circle cx="16" cy="7" r="2.5" stroke={color} strokeWidth="1.6" fill="none"/><path d="M21 18c0-2.5-1.8-4.5-4-5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    bell:     <><path d="M6 16V10a6 6 0 1112 0v6l2 2H4l2-2z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M10 20a2 2 0 004 0" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    user:     <><circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.6" fill="none"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    returns:  <path d="M9 14l-4-4 4-4M5 10h11a4 4 0 010 8h-3" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    search:   <><circle cx="11" cy="11" r="7" stroke={color} strokeWidth="1.6" fill="none"/><path d="M20 20l-4-4" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></>,
    filter:   <path d="M3 5h18l-7 9v6l-4-2v-4L3 5z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>,
    chevron:  <path d="M9 6l6 6-6 6" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    close:    <path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/>,
    alertTri: <><path d="M12 3l10 17H2L12 3z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M12 10v5M12 17v.01" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 10h18M8 3v4M16 3v4" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    check:    <path d="M5 12l5 5L20 7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    moon:     <path d="M20 14a8 8 0 01-10-10 8 8 0 1010 10z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>,
    globe:    <><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" stroke={color} strokeWidth="1.6" fill="none"/></>,
    refresh:  <><path d="M4 10V5h5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><path d="M20 14v5h-5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><path d="M4 10a8 8 0 0115-1M20 14a8 8 0 01-15 1" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    trend:    <><path d="M3 17l6-6 4 4 8-8" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 7h7v7" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: "block" }}>{icons[name]}</svg>;
}

function Donut({ bl, wa, no, size = 110, stroke = 12 }) {
  const total = bl + wa + no || 1;
  const r = (size - stroke) / 2 - 2, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const arc = (val, off) => ({ strokeDasharray: `${(val / total) * circ} ${circ}`, strokeDashoffset: -(off / total) * circ });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      {no > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#97C459" strokeWidth={stroke} {...arc(no, bl + wa)} strokeLinecap="round" />}
      {wa > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EF9F27" strokeWidth={stroke} {...arc(wa, bl)} strokeLinecap="round" />}
      {bl > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E24B4A" strokeWidth={stroke} {...arc(bl, 0)} strokeLinecap="round" />}
    </svg>
  );
}

function StatusPill({ status, size = "sm" }) {
  const sz = size === "xs" ? { px: 6, py: 1, fs: 9, dot: 5 } : { px: 8, py: 2, fs: 10, dot: 5 };
  const map = {
    BLOCK:   { bg: "#3D1212", fg: "#F09595", bd: "#7A2020", dot: "#E24B4A" },
    WARNING: { bg: "#3D2A00", fg: "#FAC775", bd: "#7A5500", dot: "#EF9F27" },
    NORMAL:  { bg: "#1A2E0A", fg: "#C0DD97", bd: "#3A6014", dot: "#639922" },
  };
  const s = map[status] || map.NORMAL;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: s.bg, color: s.fg, border: `0.5px solid ${s.bd}`, borderRadius: 5, padding: `${sz.py}px ${sz.px}px`, fontSize: sz.fs, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: sz.dot, height: sz.dot, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function ReturnStatusPill({ status, size = "sm", lang = "th" }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  const sz = size === "xs" ? { px: 6, py: 1, fs: 9, dot: 5 } : { px: 8, py: 2, fs: 10, dot: 5 };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: m.bg, color: m.color, border: `0.5px solid ${m.border}`, borderRadius: 5, padding: `${sz.py}px ${sz.px}px`, fontSize: sz.fs, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: sz.dot, height: sz.dot, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
      {lang === "th" ? m.label_short_th : m.label_en}
    </span>
  );
}

// Small chip used next to the request id to indicate the request has been
// corrected at least once. Driven by revisionHistory.length on the record.
function RevisionChip({ rev, lang = "th" }) {
  if (!rev || rev < 2) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 9, fontWeight: 700, color: "#D4357A",
      background: "rgba(212,53,122,0.12)",
      border: "0.5px solid rgba(212,53,122,0.45)",
      borderRadius: 5, padding: "1px 6px",
      letterSpacing: 0.4, textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>
      ↻ {lang === "th" ? "แก้ไขครั้งที่" : "Rev"} {rev}
    </span>
  );
}

// Fixed full-screen image viewer. Tap anywhere (outside the prev/next zones)
// to close. When there are multiple attachments, taps on the left/right
// third advance through the gallery. Stays mounted as a portal-like fixed
// element so it sits above bottom sheets.
function ImageLightbox({ open, sources, startIndex = 0, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  useEffect(() => { if (open) setIdx(startIndex); }, [open, startIndex]);
  if (!open || !Array.isArray(sources) || sources.length === 0) return null;
  const safeIdx = Math.max(0, Math.min(idx, sources.length - 1));
  const cur = sources[safeIdx];
  const multi = sources.length > 1;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
        WebkitTapHighlightColor: "transparent",
      }}
      onClick={onClose}
    >
      {multi && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx((safeIdx - 1 + sources.length) % sources.length); }}
          style={{
            position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
            width: 44, height: 44, borderRadius: 22,
            border: "0.5px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.45)", color: "#fff",
            fontSize: 22, cursor: "pointer", fontFamily: "inherit",
          }}
        >‹</button>
      )}
      <img
        src={cur?.data}
        alt={cur?.name || ""}
        style={{
          maxWidth: "92vw", maxHeight: "82vh",
          objectFit: "contain", borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      />
      {multi && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx((safeIdx + 1) % sources.length); }}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            width: 44, height: 44, borderRadius: 22,
            border: "0.5px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.45)", color: "#fff",
            fontSize: 22, cursor: "pointer", fontFamily: "inherit",
          }}
        >›</button>
      )}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 16,
          width: 40, height: 40, borderRadius: 20,
          border: "0.5px solid rgba(255,255,255,0.25)",
          background: "rgba(0,0,0,0.45)", color: "#fff",
          fontSize: 16, cursor: "pointer", fontFamily: "inherit",
        }}
      >✕</button>
      {multi && (
        <div style={{
          position: "absolute", bottom: 18, left: 0, right: 0,
          textAlign: "center", color: "rgba(255,255,255,0.7)",
          fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
        }}>
          {safeIdx + 1} / {sources.length}
        </div>
      )}
    </div>
  );
}

function TeamPill({ team, size = "sm" }) {
  const c = TEAM_COLORS[team] || "#888";
  return <span style={{ display: "inline-block", fontSize: size === "xs" ? 9 : 10, fontWeight: 500, color: c, background: c + "22", border: `0.5px solid ${c}44`, borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>{team}</span>;
}

function PrototypeBadge() {
  // Single-mode badge: this UI now always writes to the real backend
  // with isTest=true and shows up only in Desktop Admin's 🧪 TEST queue.
  // The amber-with-yellow-outline style flags it visually as test data
  // so screenshots / users can never confuse it with the production app.
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 9, fontWeight: 700, color: "#FAC775",
      background: "#3D2A00", border: "0.5px solid #FAC775",
      borderRadius: 4, padding: "2px 6px", letterSpacing: 1, textTransform: "uppercase",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FAC775" }}/>
      🧪 Test
    </span>
  );
}

function BottomSheet({ open, onClose, children, title, height = "85%", dark = true, extraRight }) {
  const sheetBg  = dark ? "#141414" : "#ffffff";
  const handleBg = dark ? "#333"    : "#e0e0e0";
  const titleBdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const titleCol = dark ? "#eee"    : "#111";
  const closeCol = dark ? "#888"    : "#666";
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: open ? "rgba(0,0,0,0.5)" : "transparent", backdropFilter: open ? "blur(2px)" : "none", transition: "background 0.25s", pointerEvents: open ? "auto" : "none", zIndex: 200 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height, background: sheetBg, borderRadius: "20px 20px 0 0", transform: open ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s cubic-bezier(.32,.72,0,1)", zIndex: 201, display: "flex", flexDirection: "column", boxShadow: "0 -8px 40px rgba(0,0,0,0.25)", maxHeight: "92vh" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: handleBg, borderRadius: 2 }} />
        </div>
        {title && (
          <div style={{ padding: "10px 20px 12px", borderBottom: `0.5px solid ${titleBdr}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: titleCol, flex: 1, minWidth: 0 }}>{title}</div>
            {extraRight}
            <button onClick={onClose} style={{ border: "none", background: "transparent", color: closeCol, fontSize: 14, cursor: "pointer", padding: 4 }}>✕</button>
          </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>{children}</div>
      </div>
    </>
  );
}

// =============================================================================
// SALE PICKER
// =============================================================================

function SalePicker({ onSelect, dark, setDark, lang, setLang }) {
  const [selected, setSelected] = useState("");
  const bg = dark ? "#0a0a0a" : "#f5f5f3";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  return (
    <div style={{ flex: 1, background: bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ padding: "32px 24px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>
            <span style={{ color: "#D4357A" }}>Neo</span><span style={{ color: text }}>Biotech</span>
          </div>
          <div style={{ display: "inline-block", fontSize: 10, color: "#D4357A", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", border: "1.5px solid #D4357A", borderRadius: 6, padding: "4px 12px", marginBottom: 8 }}>BORROW SYSTEM</div>
          <div style={{ marginBottom: 8 }}><PrototypeBadge /></div>
          <div style={{ marginBottom: 20 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: dark ? "#555" : "#aaa", background: dark ? "#1a1a1a" : "#f0f0ec", border: `0.5px solid ${dark ? "#2a2a2a" : "#ddd"}`, borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>v 1.2-proto</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: text, marginBottom: 4 }}>{lang === "th" ? "เลือกชื่อ Sale ของคุณ" : "Select your Sale name"}</div>
          <div style={{ fontSize: 12, color: sub }}>{lang === "th" ? "Prototype — ทดลอง BR Return mobile flow" : "Prototype — test mobile BR Return flow"}</div>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          {Object.entries(TEAMS).map(([team, sales]) => (
            <div key={team} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: TEAM_COLORS[team] || "#888", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, paddingLeft: 4 }}>{team} Team</div>
              <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden" }}>
                {sales.map((sale, i) => (
                  <div key={sale} onClick={() => setSelected(sale)} style={{ padding: "13px 16px", borderBottom: i < sales.length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between", background: selected === sale ? (dark ? "#2D0F1A" : "#FBE8F1") : "transparent", cursor: "pointer", userSelect: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: (TEAM_COLORS[team] || "#888") + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: TEAM_COLORS[team] || "#888" }}>
                        {sale.slice(0, 2)}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: selected === sale ? "#D4357A" : text }}>{sale}</span>
                    </div>
                    {selected === sale && <span style={{ color: "#D4357A", fontSize: 16 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: "14px 16px", background: bg, borderTop: `0.5px solid ${bdr}` }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", background: dark ? "#1a1a1a" : "#e8e8e4", borderRadius: 8, padding: 2, gap: 2 }}>
            {["th", "en"].map(l => <button key={l} onClick={() => setLang(l)} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: lang === l ? "#D4357A" : "transparent", color: lang === l ? "#fff" : sub }}>{l.toUpperCase()}</button>)}
          </div>
          <div onClick={() => setDark(d => !d)} style={{ width: 44, height: 26, borderRadius: 28, background: dark ? "#D4357A" : "rgba(0,0,0,0.12)", position: "relative", cursor: "pointer", transition: "background .25s", flexShrink: 0, display: "flex", alignItems: "center" }}>
            <div style={{ position: "absolute", top: 3, left: dark ? 20 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left .22s cubic-bezier(.4,0,.2,1)" }} />
            <span style={{ position: "absolute", left: 6, fontSize: 10, opacity: dark ? 1 : 0 }}>🌙</span>
            <span style={{ position: "absolute", right: 5, fontSize: 10, opacity: dark ? 0 : 1 }}>☀️</span>
          </div>
        </div>
        <button onClick={() => selected && onSelect(selected)} style={{ width: "100%", padding: "15px", borderRadius: 13, fontSize: 15, fontWeight: 700, border: "none", cursor: selected ? "pointer" : "not-allowed", background: selected ? "#D4357A" : "#333", color: selected ? "#fff" : "#666", transition: "all .2s" }}>
          {selected ? (lang === "th" ? `เข้าใช้งานเป็น ${selected}` : `Continue as ${selected}`) : (lang === "th" ? "กรุณาเลือก Sale" : "Select a sale")}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// HOME SCREEN
// =============================================================================

function HomeScreen({ customers, custValues, syncLogs, lang, setTab, setSelectedCustomer, refreshing, onRefresh, dark, selectedSale, returnsCount }) {
  const bl = customers.filter(c => c.status === "BLOCK").length;
  const wa = customers.filter(c => c.status === "WARNING").length;
  const no = customers.filter(c => c.status === "NORMAL").length;
  const totalBR = customers.reduce((s, c) => s + c.active_br_count, 0);
  const totalVal = customers.reduce((s, c) => s + (custValues[c.cust_code] || 0), 0);
  const criticals = [...customers].filter(c => c.status === "BLOCK").sort((a, b) => b.max_days - a.max_days).slice(0, 3);
  const lastSync = syncLogs[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? (lang === "th" ? "อรุณสวัสดิ์" : "Good morning") : hour < 17 ? (lang === "th" ? "สวัสดีตอนบ่าย" : "Good afternoon") : (lang === "th" ? "สวัสดีตอนเย็น" : "Good evening");
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  return (
    <div style={{ padding: "0 16px 24px", color: text }}>
      <div style={{ paddingTop: 6, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: sub, marginBottom: 3, fontWeight: 500 }}>{greet}</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: text }}>{lang === "th" ? "คุณ " : ""}<span style={{ color: "#D4357A" }}>{selectedSale}</span> <span style={{ color: "#D4357A" }}>·</span></div>
        <div style={{ fontSize: 11, color: sub, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#639922", display: "inline-block" }} />
          {lang === "th" ? "ออนไลน์" : "Online"} · {lastSync ? (lang === "th" ? "ซิงค์ล่าสุด" : "Last sync") + " " + new Date(lastSync.synced_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—"}
        </div>
      </div>

      {bl > 0 && (
        <div onClick={() => setTab("alerts")} style={{ background: "linear-gradient(135deg, #2D1010 0%, #1e0808 100%)", border: "1px solid #7A2020", borderRadius: 14, padding: "14px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: "#E24B4A", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="alertTri" size={20} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#F09595", fontWeight: 600, marginBottom: 2 }}>{lang === "th" ? "ต้องติดตามทันที" : "Immediate follow-up"}</div>
            <div style={{ fontSize: 14, color: "#F09595", fontWeight: 600 }}>{lang === "th" ? "มี" : "You have"} <span style={{ fontSize: 17 }}>{bl}</span> {lang === "th" ? "ลูกค้า BLOCK" : "BLOCK customers"}</div>
          </div>
          <Icon name="chevron" size={18} color="#F09595" />
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>{lang === "th" ? "ภาพรวมวันนี้" : "Today's Overview"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          [lang === "th" ? "ลูกค้าทั้งหมด" : "Total Customers", customers.length, null],
          ["BR Active", totalBR.toLocaleString(), null],
          [lang === "th" ? "มูลค่าค้างรวม" : "Outstanding", fmtVal(totalVal), "block"],
          [lang === "th" ? "วิกฤต (BLOCK)" : "Critical (BLOCK)", bl, "block"],
        ].map(([label, value, accent], i) => {
          const a = accent === "block" ? { bg: dark ? "#2D1010" : "#FCEBEB", bd: dark ? "#7A2020" : "#F09595", fg: dark ? "#F09595" : "#A32D2D" } : null;
          return (
            <div key={i} style={{ background: a ? a.bg : card, border: `1px solid ${a ? a.bd : bdr}`, borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: a ? a.fg : sub, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
              <div style={{ fontSize: i === 2 ? 18 : 22, fontWeight: 700, color: a ? a.fg : text, letterSpacing: -0.5 }}>{value}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: text, marginBottom: 10 }}>{lang === "th" ? "สัดส่วนสถานะ" : "Status Breakdown"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", width: 110, height: 110, flexShrink: 0 }}>
            <Donut bl={bl} wa={wa} no={no} size={110} stroke={12} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: text, lineHeight: 1 }}>{customers.length}</div>
              <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>total</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {[["BLOCK", bl, "#E24B4A"], ["WARNING", wa, "#EF9F27"], ["NORMAL", no, "#639922"]].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: sub, flex: 1 }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: text }}>{v}</span>
                <span style={{ fontSize: 10, color: dark ? "#555" : "#999", width: 32, textAlign: "right" }}>{Math.round(v / customers.length * 100) || 0}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {criticals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: text }}>{lang === "th" ? "ลูกค้าวิกฤต" : "Critical Customers"}</div>
            <button onClick={() => setTab("alerts")} style={{ border: "none", background: "transparent", color: "#D4357A", fontSize: 11, fontWeight: 600, padding: 4, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}>
              {lang === "th" ? "ดูทั้งหมด" : "View all"} <Icon name="chevron" size={12} color="#D4357A" />
            </button>
          </div>
          <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 14, overflow: "hidden" }}>
            {criticals.map((c, i) => (
              <div key={c.cust_code} onClick={() => setSelectedCustomer(c)} style={{ padding: "12px 14px", borderBottom: i < criticals.length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: dark ? "#2D1010" : "#FDF0F0", color: dark ? "#F09595" : "#A32D2D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                  {c.customer_name.slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name}</div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>{c.cust_code}</span>·
                    <TeamPill team={c.team} size="xs" />·
                    <span>{c.sale}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: dark ? "#F09595" : "#A32D2D" }}>{c.max_days}<span style={{ fontSize: 9, fontWeight: 500, marginLeft: 2, color: sub }}>{lang === "th" ? "วัน" : "d"}</span></div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{fmtVal(custValues[c.cust_code])}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Quick Actions</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["refresh", lang === "th" ? "รีเฟรช" : "Refresh", "#D4357A", onRefresh],
          ["returns", lang === "th" ? `คืนสินค้า${returnsCount ? ` (${returnsCount})` : ""}` : `Returns${returnsCount ? ` (${returnsCount})` : ""}`, "#97C459", () => setTab("returns")],
          ["users", lang === "th" ? "ลูกค้า" : "Customers", "#378ADD", () => setTab("customers")],
          ["bell", lang === "th" ? "แจ้งเตือน" : "Alerts", "#EF9F27", () => setTab("alerts")],
        ].map(([icon, label, col, action], i) => (
          <div key={i} onClick={action} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: col + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={icon} size={16} color={col} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: text }}>{refreshing && icon === "refresh" ? (lang === "th" ? "กำลังโหลด..." : "Loading...") : label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// CUSTOMERS SCREEN
// =============================================================================

function CustomersScreen({ customers, custValues, lang, setSelectedCustomer, dark }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("days");
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const filtered = useMemo(() => {
    let list = customers.filter(c =>
      (!search || c.customer_name.toLowerCase().includes(search.toLowerCase()) || c.cust_code.toLowerCase().includes(search.toLowerCase())) &&
      (!statusFilter || c.status === statusFilter)
    );
    if (sort === "days") list.sort((a, b) => b.max_days - a.max_days);
    else if (sort === "value") list.sort((a, b) => (custValues[b.cust_code] || 0) - (custValues[a.cust_code] || 0));
    else list.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
    return list;
  }, [customers, search, statusFilter, sort, custValues]);

  return (
    <div style={{ color: text, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative", background: card, border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
            <Icon name="search" size={16} color={sub} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === "th" ? "ค้นหาลูกค้า..." : "Search customer..."} style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "10px 8px", fontSize: 13, color: text }} />
            {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", color: sub, cursor: "pointer", padding: 4 }}><Icon name="close" size={14} color={sub} /></button>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
          {[["", lang === "th" ? "ทั้งหมด" : "All"], ["BLOCK", "BLOCK"], ["WARNING", "WARNING"], ["NORMAL", "NORMAL"]].map(([v, l]) => {
            const active = statusFilter === v;
            const col = v === "BLOCK" ? "#E24B4A" : v === "WARNING" ? "#EF9F27" : v === "NORMAL" ? "#639922" : "#D4357A";
            return <button key={v} onClick={() => setStatusFilter(v)} style={{ padding: "6px 13px", fontSize: 11, fontWeight: 600, borderRadius: 16, flexShrink: 0, border: `1px solid ${active ? col : "rgba(255,255,255,0.1)"}`, background: active ? col : card, color: active ? "#fff" : sub, cursor: "pointer" }}>{l}</button>;
          })}
        </div>
        <div style={{ fontSize: 10, color: sub, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
          <span>{filtered.length} {lang === "th" ? "รายการ" : "results"}</span>
          <span>{lang === "th" ? "เรียงโดย" : "Sort"}: <button onClick={() => setSort(s => s === "days" ? "value" : s === "value" ? "name" : "days")} style={{ background:"transparent", border: "none", color: "#D4357A", fontWeight: 600, cursor: "pointer", padding: 0, font: "inherit" }}>{sort === "days" ? (lang === "th" ? "วันค้าง" : "Days") : sort === "value" ? (lang === "th" ? "มูลค่า" : "Value") : (lang === "th" ? "ชื่อ" : "Name")}</button></span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
        {filtered.map(c => {
          const val = custValues[c.cust_code];
          const rowBg = c.status === "BLOCK" ? (dark ? "#1A0A0A" : "#FEF5F5") : c.status === "WARNING" ? (dark ? "#1A1400" : "#FEFAEE") : card;
          const daysColor = c.max_days > 180 ? (dark ? "#F09595" : "#A32D2D") : c.max_days > 90 ? (dark ? "#FAC775" : "#854F0B") : text;
          return (
            <div key={c.cust_code} onClick={() => setSelectedCustomer(c)} style={{ background: rowBg, border: `0.5px solid ${bdr}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, flexShrink: 0, background: c.status === "BLOCK" ? "#3D1212" : c.status === "WARNING" ? "#3D2A00" : "#1A2E0A", color: c.status === "NORMAL" ? "#C0DD97" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>
                {c.customer_name.slice(0, 2)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name}</div>
                <div style={{ fontSize: 10, color: sub, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace,monospace" }}>{c.cust_code}</span>·
                  <TeamPill team={c.team} size="xs" />·
                  <span>{c.sale}</span>·
                  <span>{c.active_br_count} BR</span>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <StatusPill status={c.status} size="xs" />
                <div style={{ fontSize: 13, fontWeight: 700, color: daysColor }}>{c.max_days}<span style={{ fontSize: 9, fontWeight: 500, marginLeft: 2, color: sub }}>{lang === "th" ? "วัน" : "d"}</span></div>
                <div style={{ fontSize: 10, color: sub }}>{fmtVal(val)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// ALERTS SCREEN
// =============================================================================

function AlertsScreen({ customers, custValues, lang, setSelectedCustomer, dark }) {
  const [tab, setTab] = useState("BLOCK");
  const blocks = customers.filter(c => c.status === "BLOCK").sort((a, b) => b.max_days - a.max_days);
  const warns = customers.filter(c => c.status === "WARNING").sort((a, b) => b.max_days - a.max_days);
  const list = tab === "BLOCK" ? blocks : warns;
  const col = tab === "BLOCK" ? "#E24B4A" : "#EF9F27";
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  return (
    <div style={{ color: text, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 16px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: 3, gap: 3 }}>
          {[["BLOCK", blocks.length, "#E24B4A"], ["WARNING", warns.length, "#EF9F27"]].map(([k, n, c]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "9px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 8, background: tab === k ? c : "transparent", color: tab === k ? "#fff" : sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {k} <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: tab === k ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.06)", color: tab === k ? "#fff" : sub, fontWeight: 700 }}>{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
        {list.map((c, idx) => (
          <div key={c.cust_code} onClick={() => setSelectedCustomer(c)} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: 0, marginBottom: 9, overflow: "hidden", position: "relative", cursor: "pointer" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: col }} />
            <div style={{ padding: "13px 14px 13px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: col + "33", color: col, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                    <div style={{ fontSize: 14, fontWeight: 600, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{c.customer_name}</div>
                  </div>
                  <div style={{ fontSize: 10, color: sub, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>{c.cust_code}</span>·
                    <TeamPill team={c.team} size="xs" />·<span>{c.sale}</span>·<span>{c.active_br_count} BR</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: col, lineHeight: 1 }}>{c.max_days}</div>
                  <div style={{ fontSize: 9, color: sub, marginTop: 2 }}>{lang === "th" ? "วัน" : "days"}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: text, background: dark ? "#222" : "#f5f5f3", padding: "4px 9px", borderRadius: 6 }}>{fmtVal(custValues[c.cust_code])}</div>
                <button onClick={e => { e.stopPropagation(); setSelectedCustomer(c); }} style={{ padding: "0 12px", height: 32, borderRadius: 8, border: "none", background: "#D4357A", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                  {lang === "th" ? "ดูรายละเอียด" : "View detail"} <Icon name="chevron" size={12} color="#fff" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// REQUEST RETURN FLOW (4 steps inside a BottomSheet)
// =============================================================================

function RequestReturnSheet({ open, onClose, br, customer, sale, lang, dark, onSubmitted, editingRequest = null }) {
  const isEditing = !!editingRequest;
  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [perItem, setPerItem] = useState({}); // item_id -> { retQty, clmQty, saleQty, freeQty }
  const [remark, setRemark] = useState("");
  // Submit-state (async, backend-aware): submitting disables the Submit
  // button + shows a spinner; submitError lives at the bottom of Step 4
  // and tells the Sale exactly what failed. Both reset on sheet open.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // ── Editing mode: synthesise br/customer/items from the rejected record ──
  // The Sale-side resubmission path reads everything it needs straight off
  // the existing return record — no fresh /customers/{cc}/brs fetch. The
  // "items" surface for Step 1 is the set of rejected items only, matching
  // Desktop br-return.html:3156-3167 (editRejectedOnly = true). Approved
  // items pass through untouched at submit-time.
  const editCustomer = isEditing
    ? { customer_name: editingRequest.cust, cust_code: editingRequest.custCode }
    : null;
  const editBr = isEditing
    ? {
        borrow_no: editingRequest.br,
        items: (editingRequest.rejectedItems || []).map(r => ({
          item_id: r.itemId || r.item_id || `${r.code || r.product_code}-${r.lineNo || r.line_no || ""}`,
          line_no: r.lineNo || r.line_no,
          product_code: r.code || r.product_code,
          product_name: r.name || r.product_name,
          price: Number(r.price) || 0,
          // In edit mode, the max re-allocatable qty is the qty originally
          // submitted for this row (Sale cannot suddenly inflate the count).
          quantity: Number(r.quantity) || 0,
          _rejectReason: r.reason || "",
        })),
      }
    : null;

  const effectiveCustomer = isEditing ? editCustomer : customer;
  const effectiveBr       = isEditing ? editBr       : br;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubmitting(false);
    setSubmitError("");
    if (isEditing) {
      // Pre-select every rejected row (Sale needs to address all of them
      // to fix the request) but leave qty allocation BLANK — Sale must
      // re-enter the corrected numbers explicitly, exactly like Desktop
      // (br-return.html:3167 has no qty pre-fill).
      const ids = new Set();
      const initAlloc = {};
      for (const r of (editingRequest.rejectedItems || [])) {
        const id = r.itemId || r.item_id || `${r.code || r.product_code}-${r.lineNo || r.line_no || ""}`;
        ids.add(id);
        initAlloc[id] = { retQty: 0, clmQty: 0, saleQty: 0, freeQty: 0 };
      }
      setSelectedIds(ids);
      setPerItem(initAlloc);
      setRemark(editingRequest.remark || "");
    } else {
      setSelectedIds(new Set());
      setPerItem({});
      setRemark("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, br?.borrow_no, editingRequest?.id]);

  if (!effectiveBr || !effectiveCustomer) {
    return <BottomSheet open={open} onClose={onClose} height="92%" dark={dark} title={lang === "th" ? (isEditing ? "แก้ไขคำขอ" : "ขอคืนสินค้า") : (isEditing ? "Edit Request" : "Request Return")} />;
  }

  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const items = Array.isArray(effectiveBr.items) ? effectiveBr.items : [];
  const selectedItems = items.filter(it => selectedIds.has(it.item_id));

  // Items previously approved by Admin — shown as a read-only summary above
  // Step 1's editable list so the Sale has full context of the request.
  const approvedPassthroughItems = isEditing
    ? (editingRequest.submittedItems || []).filter(si => {
        const wasRejected = (editingRequest.rejectedItems || []).some(r =>
          (r.itemId && r.itemId === si.item_id)
          || ((r.code || r.product_code) === si.product_code && (r.lineNo || r.line_no) === si.line_no)
        );
        return !wasRejected;
      })
    : [];

  // ── Per-item allocation model ────────────────────────────────────────
  // perItem[id] = { retQty, clmQty, saleQty, freeQty }
  // Mirrors the desktop BR Return flow: one source row can be split into
  // multiple return types simultaneously, as long as the sum across types
  // does not exceed the source row's available quantity.
  const QTY_KEY = { RETURN: "retQty", CLAIM: "clmQty", SALE: "saleQty", FREE: "freeQty" };
  const blankAlloc = () => ({ retQty: 0, clmQty: 0, saleQty: 0, freeQty: 0 });

  function togglePick(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { next.add(id); }
      return next;
    });
    setPerItem(prev => {
      if (prev[id]) return prev;
      // Start fully empty — Sale chooses qty+type explicitly. No pre-fill so
      // the workflow does not accidentally suggest "all RETURN" before Sale
      // has actually decided. User must allocate at least one piece across
      // any type for Step 2 validation to pass (see validStep2).
      return { ...prev, [id]: blankAlloc() };
    });
  }

  // Set a single type's qty for one item, clamped so the total across all
  // four types never exceeds the source row's available quantity.
  function setItemTypeQty(id, typeKey, nextQty) {
    const it = items.find(i => i.item_id === id);
    if (!it) return;
    const max = it.quantity;
    setPerItem(prev => {
      const cur = prev[id] || blankAlloc();
      const otherTotal = (cur.retQty || 0) + (cur.clmQty || 0) + (cur.saleQty || 0) + (cur.freeQty || 0) - (cur[QTY_KEY[typeKey]] || 0);
      const clamped = Math.max(0, Math.min(nextQty, max - otherTotal));
      return { ...prev, [id]: { ...cur, [QTY_KEY[typeKey]]: clamped } };
    });
  }

  // Bulk "Select all as TYPE" — sets every currently-selected item so that
  // the chosen type gets the item's full available quantity and the other
  // three types are zeroed. Matches the desktop quick-fill buttons.
  function selectAllAsType(typeKey) {
    setPerItem(prev => {
      const next = { ...prev };
      for (const id of selectedIds) {
        const it = items.find(i => i.item_id === id);
        if (!it) continue;
        next[id] = { ...blankAlloc(), [QTY_KEY[typeKey]]: it.quantity };
      }
      return next;
    });
  }

  function totalForItem(id) {
    const cur = perItem[id] || blankAlloc();
    return (cur.retQty || 0) + (cur.clmQty || 0) + (cur.saleQty || 0) + (cur.freeQty || 0);
  }

  const submittedItems = selectedItems.map(it => {
    const cur = perItem[it.item_id] || blankAlloc();
    const retQty  = Math.max(0, cur.retQty  || 0);
    const clmQty  = Math.max(0, cur.clmQty  || 0);
    const saleQty = Math.max(0, cur.saleQty || 0);
    const freeQty = Math.max(0, cur.freeQty || 0);
    const totalQty = retQty + clmQty + saleQty + freeQty;
    const price = Number(it.price) || 0;
    // Match the EXACT field shape Desktop BR Return writes for items.
    // Desktop's renderer (br-return.html) reads `code`, `name`, `itemId`,
    // `lineNo`, `lineKey`. Earlier we only sent `product_code` /
    // `product_name` / `item_id` / `line_no` (snake_case), so Desktop
    // rendered the product name as `undefined`. Now we send the
    // Desktop-canonical keys AND keep the snake_case aliases so Mobile's
    // own renderers (which read either) keep working.
    return {
      // Desktop-canonical:
      code: it.product_code,
      name: it.product_name,
      price,
      quantity: totalQty,
      totalPrice: price * totalQty,
      retQty, clmQty, saleQty, freeQty,
      itemId: it.item_id,
      lineNo: it.line_no,
      lineKey: `line:${it.line_no}|code:${it.product_code}`,
      // Mobile aliases (read by breakdownFor + various detail views):
      item_id: it.item_id,
      line_no: it.line_no,
      product_code: it.product_code,
      product_name: it.product_name,
    };
  });
  const totalValue = submittedItems.reduce((s, x) => s + x.totalPrice, 0);
  // Valid when every selected item has at least 1 allocated AND the total
  // allocation doesn't exceed the source row's quantity. The setter already
  // clamps, but we still guard here in case state was hand-edited.
  const validStep2 = submittedItems.every(x => {
    const avail = (items.find(i => i.item_id === x.item_id)?.quantity || 0);
    return x.quantity > 0 && x.quantity <= avail;
  });

  async function submit() {
    if (submitting) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      if (isEditing) {
        // Resubmit corrected request — keep the same id; submittedItems
        // now contains ONLY the corrected items (NOT merged with the
        // already-approved ones). This makes Desktop Admin see only
        // what was just re-touched, per the user's correction-flow
        // intent: "Admin should see only the corrected/resubmitted
        // item(s), not the full original item list".
        //
        // The approved items aren't lost — they're snapshotted into
        // revisionHistory[N].prevSubmittedItems and the request's
        // ORIGINAL submittedItems are preserved in revisionHistory[0]
        // (when present). The history viewer on Desktop can replay
        // each round.
        //
        // Mirrors Desktop br-return.html:2960-2963 (status='pending',
        // adminNote='', rejectedItems=[], attachments=[]) plus the
        // prototype-only revisionHistory extension.
        const orig = editingRequest;
        const prevHistory = Array.isArray(orig.revisionHistory) ? orig.revisionHistory : [];
        // Track which item_ids were corrected in this revision so the
        // Return Detail view can filter when needed.
        const correctedItemIds = (orig.rejectedItems || [])
          .map(r => r.itemId || r.item_id || `${r.code || r.product_code}-${r.lineNo || r.line_no || ""}`)
          .filter(Boolean);
        // Richer snapshot: includes the full prior state (items, admin
        // note, rejected items + reasons, photos) so the Desktop
        // "ดูประวัติแก้ไข" viewer can show what each correction round
        // contained. The previous revision's submittedItems is the
        // single most important piece — without it, history is just
        // counts.
        const snapshot = {
          at: new Date().toISOString(),
          prevStatus: orig.status || "rejected",
          prevAdminNote: orig.adminNote || "",
          prevSubmittedItems: Array.isArray(orig.submittedItems) ? orig.submittedItems : [],
          prevRejectedItems: Array.isArray(orig.rejectedItems) ? orig.rejectedItems : [],
          prevAttachments: Array.isArray(orig.attachments) ? orig.attachments : [],
          prevRejectedItemCount: (orig.rejectedItems || []).length,
          prevAttachmentCount: (orig.attachments || []).length,
          correctedItemIds,
        };
        // Await the backend round-trip. If it rejects, the in-cache
        // change is rolled back inside replaceProtoReturn so the user
        // stays on Step 4 with an error toast and the request is still
        // editable on retry.
        const updated = await replaceProtoReturn(orig.id, {
          status: "pending",
          submittedItems: submittedItems,           // ← ONLY the corrected items
          items: submittedItems.length,
          adminNote: "",
          rejectedItems: [],
          attachments: [],
          remark: remark.trim() || orig.remark || "",
          dateSort: todayDateSort(),                // INT4-safe; matches Desktop format
          resubmittedAt: new Date().toISOString(),
          revisionHistory: [...prevHistory, snapshot],
        });
        if (onSubmitted) onSubmitted(updated || orig);
        return;
      }
      const newReq = {
        id: genProtoReturnId(),
        cust: effectiveCustomer.customer_name,
        custCode: effectiveCustomer.cust_code,
        br: effectiveBr.borrow_no,
        items: submittedItems.length,
        sale,
        status: "pending",
        date: new Date().toISOString(),
        dateSort: todayDateSort(),     // INT4-safe; matches Desktop format
        remark: remark.trim(),
        adminNote: "",
        rejectedItems: [],
        attachments: [],
        submittedItems,
        cancelReason: "",
        sheetSync: "none",
        sheetSyncAt: "",
        sheetSyncError: "",
        revisionHistory: [],
        _prototype: true,
      };
      // Await persistence before opening the full-screen success view.
      // If the POST is rejected (e.g. backend 500), the optimistic cache
      // insert is rolled back inside upsertProtoReturn and we surface a
      // human-readable error on Step 4 instead of pretending success.
      const persisted = await upsertProtoReturn(newReq);
      if (onSubmitted) onSubmitted(persisted || newReq);
    } catch (err) {
      setSubmitError(
        (err && err.message)
          ? (lang === "th" ? `บันทึกคำขอไม่สำเร็จ — ${err.message}` : `Submit failed — ${err.message}`)
          : (lang === "th" ? "บันทึกคำขอไม่สำเร็จ ลองอีกครั้ง" : "Submit failed — please retry")
      );
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = lang === "th"
    ? ["เลือก", "จำนวน", "หมายเหตุ", "ตรวจสอบ"]
    : ["Select", "Quantity", "Remark", "Review"];

  return (
    <BottomSheet open={open} onClose={onClose} height="92%" dark={dark}>
      {/* Header */}
      <div style={{ padding: "4px 20px 12px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: isEditing ? "#D4357A" : sub }}>
              {isEditing
                ? (lang === "th" ? `📝 แก้ไขคำขอ · ${editingRequest.id}` : `📝 Edit · ${editingRequest.id}`)
                : (lang === "th" ? "ขอคืนสินค้า" : "Request Return")}
            </div>
            <PrototypeBadge />
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="close" size={14} color={sub} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, fontSize: 11, color: sub, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "ui-monospace,monospace", color: text, fontWeight: 600 }}>{effectiveBr.borrow_no}</span>·
          <span>{effectiveCustomer.customer_name}</span>·
          <span style={{ fontFamily: "ui-monospace,monospace" }}>{effectiveCustomer.cust_code}</span>
        </div>
        {/* Steps */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 12 }}>
          {stepLabels.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600, color: active ? "#D4357A" : done ? "#97C459" : sub }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: active ? "#D4357A" : done ? "#1A2E0A" : (dark ? "#1a1a1a" : "#f5f5f3"), color: active ? "#fff" : done ? "#97C459" : sub, border: `0.5px solid ${active ? "#D4357A" : done ? "#3A6014" : (dark ? "#333" : "#ddd")}`, fontSize: 10, fontWeight: 700 }}>
                  {done ? "✓" : n}
                </div>
                <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                {i < stepLabels.length - 1 && <div style={{ flex: 1, height: 0.5, background: dark ? "#2a2a2a" : "#ddd", margin: "0 4px" }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", color: text }}>
        {step === 1 && (
          <>
            {/* Editing-mode context banner. Reminds the Sale that they are
                revising a request, points at the Admin's global remark, and
                lets them know that approved items pass through untouched. */}
            {isEditing && (
              <div style={{
                background: STATUS_META.rejected.bg,
                border: `0.5px solid ${STATUS_META.rejected.border}`,
                borderRadius: 11, padding: "11px 13px", marginBottom: 12,
                color: "#fff",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, letterSpacing: 0.4, textTransform: "uppercase", color: "#fff" }}>
                  ↻ {lang === "th" ? "กำลังแก้ไขคำขอ" : "Editing request"}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: "#fff" }}>
                  {lang === "th"
                    ? `แก้ไขเฉพาะรายการที่ Admin ขอแก้ ${editingRequest.rejectedItems?.length || 0} รายการ — รายการอื่นจะคงเดิม`
                    : `Edit only the ${editingRequest.rejectedItems?.length || 0} item(s) Admin flagged. The rest are kept as-is.`}
                </div>
                {editingRequest.adminNote && (
                  <div style={{ marginTop: 7, fontSize: 11, color: "#fff", lineHeight: 1.5, whiteSpace: "pre-line", opacity: 0.92 }}>
                    <b>{lang === "th" ? "หมายเหตุ Admin: " : "Admin note: "}</b>{editingRequest.adminNote}
                  </div>
                )}
              </div>
            )}
            {/* Approved-passthrough summary — read-only so Sale sees the full
                picture but cannot accidentally re-touch items Admin already
                accepted. */}
            {isEditing && approvedPassthroughItems.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: STATUS_META.approved.color, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
                  ✓ {lang === "th" ? `อนุมัติแล้ว (คงเดิม)` : "Approved (kept)"} ({approvedPassthroughItems.length})
                </div>
                <div style={{ background: card, border: `0.5px dashed ${STATUS_META.approved.border}`, borderRadius: 11, overflow: "hidden" }}>
                  {approvedPassthroughItems.map((si, i) => (
                    <div key={i} style={{ padding: "9px 12px", borderBottom: i < approvedPassthroughItems.length - 1 ? `0.5px solid ${bdr}` : "none", opacity: 0.85 }}>
                      <div style={{ fontSize: 10, color: sub, fontFamily: "ui-monospace,monospace" }}>{si.product_code || si.code}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: text }}>{si.product_name}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>
                        {si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} · ฿{Number(si.totalPrice || 0).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Header row: section label + Select-All toggle. The toggle flips
                between "เลือกทั้งหมด" (when not everything is selected) and
                "ล้างการเลือก" (when everything is already selected) so one
                button covers both bulk operations. Disabled when there are
                no items. */}
            {(() => {
              const allSelected = items.length > 0 && selectedIds.size === items.length;
              const disabled = items.length === 0;
              return (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: isEditing ? STATUS_META.rejected.color : sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
                    {isEditing
                      ? (lang === "th" ? "ส่วนที่ต้องแก้ไข" : "Items to revise")
                      : (lang === "th" ? "เลือกรายการที่จะคืน" : "Select items to return")}
                  </div>
                  <button
                    onClick={() => {
                      if (disabled) return;
                      if (allSelected) {
                        // Deselect everything. Keep perItem allocations
                        // around in case the Sale re-selects later — they
                        // are filtered through selectedIds downstream so
                        // stale entries are ignored.
                        setSelectedIds(new Set());
                      } else {
                        // Select every item. Initialize per-item allocation
                        // for any newly-added id to a blank slate so Step 2
                        // does not pre-fill any quantity (matches the
                        // existing single-tap selection behavior).
                        const allIds = items.map(it => it.item_id);
                        setSelectedIds(new Set(allIds));
                        setPerItem(prev => {
                          const next = { ...prev };
                          for (const id of allIds) {
                            if (!next[id]) next[id] = blankAlloc();
                          }
                          return next;
                        });
                      }
                    }}
                    disabled={disabled}
                    style={{
                      fontSize: 11, fontWeight: 700,
                      padding: "5px 11px", borderRadius: 999,
                      border: `1px solid ${allSelected ? bdr : "#D4357A"}`,
                      background: allSelected ? "transparent" : (dark ? "rgba(212,53,122,0.12)" : "rgba(212,53,122,0.08)"),
                      color: allSelected ? sub : "#D4357A",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.4 : 1,
                      fontFamily: "inherit",
                      display: "inline-flex", alignItems: "center", gap: 5,
                      letterSpacing: 0.2,
                    }}
                  >
                    {allSelected
                      ? (lang === "th" ? "ล้างการเลือก" : "Clear all")
                      : (lang === "th" ? "เลือกทั้งหมด" : "Select all")}
                  </button>
                </div>
              );
            })()}
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: sub, fontSize: 12 }}>{lang === "th" ? "ไม่มีรายการในใบยืมนี้" : "No items in this BR"}</div>
            ) : items.map(it => {
              const checked = selectedIds.has(it.item_id);
              const rejectReason = isEditing ? (it._rejectReason || "") : "";
              return (
                // Selected state distinguished ONLY by pink border + outer ring + filled checkbox.
                // Card background and all text colors stay identical to the unselected state so
                // the content remains clearly readable per user feedback.
                <div key={it.item_id} onClick={() => togglePick(it.item_id)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "13px 14px", background: card, border: `1px solid ${checked ? "#D4357A" : bdr}`, borderRadius: 12, marginBottom: 8, cursor: "pointer", boxShadow: checked ? "0 0 0 1px #D4357A55" : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1, border: `1.5px solid ${checked ? "#D4357A" : "rgba(255,255,255,0.15)"}`, background: checked ? "#D4357A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {checked && <Icon name="check" size={14} color="#fff" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 11, color: sub, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{it.product_code}</div>
                      {isEditing && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: STATUS_META.rejected.color, background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.3, textTransform: "uppercase" }}>
                          {lang === "th" ? "ต้องแก้ไข" : "Revise"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, margin: "2px 0 4px", color: text }}>{it.product_name}</div>
                    <div style={{ fontSize: 10, color: sub }}>{it.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{Number(it.price).toLocaleString()} = ฿{(Number(it.price) * it.quantity).toLocaleString()}</div>
                    {rejectReason && (
                      <div style={{ marginTop: 6, padding: "6px 9px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 6, fontSize: 10, color: STATUS_META.rejected.color, lineHeight: 1.45 }}>
                        <b>{lang === "th" ? "เหตุผล: " : "Reason: "}</b>{rejectReason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ระบุจำนวนแยกประเภท" : "Allocate quantity per type"} ({submittedItems.length})</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 12, lineHeight: 1.5 }}>
              {lang === "th"
                ? "แบ่งจำนวนได้หลายประเภทต่อรายการ (RETURN / CLAIM / SALE / FREE) รวมกันไม่เกินจำนวนที่มีอยู่"
                : "Split one item across multiple types. Total per item must not exceed available qty."}
            </div>

            {/* Quick "Select all as type" bar — matches the desktop quick-fill */}
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: sub, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                {lang === "th" ? "เลือกทั้งหมดเป็น" : "Select all as"}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {RETURN_TYPES.map(t => (
                  <button
                    key={t.key}
                    onClick={() => selectAllAsType(t.key)}
                    style={{
                      flex: 1, padding: "8px 4px", borderRadius: 8,
                      border: `1px solid ${t.border}`,
                      color: t.color, background: "transparent",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      textAlign: "center", fontFamily: "inherit",
                    }}
                  >
                    {t.icon} {typeLabel(t, lang)}
                  </button>
                ))}
              </div>
            </div>

            {submittedItems.map(si => {
              const original = items.find(i => i.item_id === si.item_id);
              const avail = original?.quantity || 0;
              const allocated = (si.retQty || 0) + (si.clmQty || 0) + (si.saleQty || 0) + (si.freeQty || 0);
              const remaining = avail - allocated;
              const remColor = remaining === 0 ? "#97C459" : remaining > 0 ? (dark ? "#FAC775" : "#854F0B") : "#E24B4A";
              const price = Number(original?.price) || 0;

              return (
                <div key={si.item_id} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: 14, marginBottom: 10 }}>
                  {/* Header — code, name, available + remaining */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: sub, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{original?.product_code}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{original?.product_name}</div>
                    <div style={{ fontSize: 10, color: sub, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{lang === "th" ? "มีอยู่" : "Available"}: <span style={{ color: text, fontWeight: 600 }}>{avail} {lang === "th" ? "ชิ้น" : "pcs"}</span></span>
                      <span style={{ color: remColor, fontWeight: 700 }}>
                        {lang === "th" ? "เหลือ" : "Remaining"}: {remaining} {remaining === 0 ? "✓" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Four type rows — chip · stepper · value */}
                  {RETURN_TYPES.map(t => {
                    const cur = perItem[si.item_id] || blankAlloc();
                    const qty = cur[QTY_KEY[t.key]] || 0;
                    const canInc = remaining > 0;
                    const lineVal = qty * price;
                    return (
                      <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `0.5px solid ${bdr}` }}>
                        {/* Type chip */}
                        <div style={{ minWidth: 70, fontSize: 11, fontWeight: 700, color: qty > 0 ? t.color : (dark ? "#666" : "#999") }}>
                          {t.icon} {typeLabel(t, lang)}
                        </div>
                        {/* Stepper */}
                        <div style={{ display: "flex", alignItems: "center", background: dark ? "#1a1a1a" : "#f5f5f3", borderRadius: 7, padding: 2, border: `0.5px solid ${bdr}`, flexShrink: 0 }}>
                          <button
                            onClick={() => setItemTypeQty(si.item_id, t.key, qty - 1)}
                            disabled={qty <= 0}
                            style={{ width: 26, height: 26, border: "none", background: "transparent", color: qty > 0 ? "#D4357A" : (dark ? "#444" : "#ccc"), fontSize: 16, fontWeight: 700, cursor: qty > 0 ? "pointer" : "not-allowed", borderRadius: 5, padding: 0, fontFamily: "inherit" }}
                          >−</button>
                          <span style={{ width: 28, textAlign: "center", fontSize: 13, fontWeight: 700, color: qty > 0 ? text : sub }}>{qty}</span>
                          <button
                            onClick={() => setItemTypeQty(si.item_id, t.key, qty + 1)}
                            disabled={!canInc}
                            style={{ width: 26, height: 26, border: "none", background: "transparent", color: canInc ? "#D4357A" : (dark ? "#444" : "#ccc"), fontSize: 16, fontWeight: 700, cursor: canInc ? "pointer" : "not-allowed", borderRadius: 5, padding: 0, fontFamily: "inherit" }}
                          >+</button>
                        </div>
                        {/* Value */}
                        <div style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: qty > 0 ? 700 : 400, color: qty > 0 ? t.color : (dark ? "#444" : "#bbb") }}>
                          {qty > 0 ? `฿${lineVal.toLocaleString()}` : "—"}
                        </div>
                      </div>
                    );
                  })}

                  {/* Per-item subtotal */}
                  <div style={{ marginTop: 10, padding: "8px 11px", background: dark ? "#0a0a0a" : "#f8f8f6", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                    <span style={{ color: sub }}>{lang === "th" ? `รวม ${allocated} ชิ้น` : `${allocated} pcs total`}</span>
                    <span style={{ color: allocated > 0 ? "#D4357A" : sub, fontWeight: 700 }}>฿{(allocated * price).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 14, padding: 14, background: "#2D0F1A", border: "0.5px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมทั้งหมด" : "Grand total"}</span>
              <span style={{ fontSize: 15, color: "#D4357A", fontWeight: 700 }}>฿{totalValue.toLocaleString()}</span>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "หมายเหตุ (ถ้ามี)" : "Remark (optional)"}</div>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder={lang === "th" ? "ระบุรายละเอียดที่ Admin ควรทราบ..." : "Add any details Admin should know..."}
              style={{ width: "100%", minHeight: 140, borderRadius: 12, padding: "12px 14px", background: card, border: `0.5px solid ${remark.length >= 500 ? "#EF9F27" : bdr}`, color: text, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, resize: "none", outline: "none" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: 10, color: remark.length >= 500 ? "#EF9F27" : sub }}>
              <span>{remark.length >= 500 ? (lang === "th" ? "ครบ 500 อักษรแล้ว" : "Max 500 chars reached") : ""}</span>
              <span>{remark.length} / 500</span>
            </div>
            <div style={{ fontSize: 11, color: sub, marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "รายการที่จะส่ง" : "Items to submit"}</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden" }}>
              {submittedItems.map(si => {
                const breakdown = breakdownFor(si);
                // Tint follows the first / only type for visual lightness; if
                // mixed, default to pink to indicate "compound entry".
                const primaryColor = breakdown.length === 1 ? breakdown[0].color : "#D4357A";
                return (
                  <div key={si.item_id} style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between", gap: 10, borderBottom: `0.5px solid ${bdr}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{si.product_code}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <span>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"}</span>
                        {breakdown.map(b => (
                          <span key={b.key} style={{ color: b.color, fontWeight: 600 }}>
                            {b.icon} {b.qty}{breakdown.length > 1 ? ` ${typeLabel(b, lang)}` : ` ${typeLabel(b, lang).toUpperCase()}`}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: primaryColor, whiteSpace: "nowrap" }}>฿{si.totalPrice.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            {isEditing && (
              <div style={{
                background: "#2D0F1A",
                border: "1px solid #D4357A66",
                borderRadius: 11, padding: "11px 13px", marginBottom: 12,
                color: "#fff",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, letterSpacing: 0.4, textTransform: "uppercase", color: "#fff" }}>
                  📝 {lang === "th" ? "กำลังแก้ไขคำขอ" : "Editing request"} · {editingRequest.id}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: "#fff" }}>
                  {lang === "th"
                    ? `${approvedPassthroughItems.length} รายการที่ Admin อนุมัติแล้วจะคงเดิม · ${submittedItems.length} รายการแก้ไขใหม่จะถูกส่งให้ Admin ตรวจอีกครั้ง`
                    : `${approvedPassthroughItems.length} approved item(s) will be kept as-is · ${submittedItems.length} revised item(s) will be re-sent for Admin review.`}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ตรวจสอบก่อนส่ง" : "Review before submit"}</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 10 }}>
              <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10, color: sub }}>{lang === "th" ? "ลูกค้า" : "Customer"}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{effectiveCustomer.customer_name}</div>
                </div>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: sub }}>{effectiveCustomer.cust_code}</span>
              </div>
              <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}` }}>
                <div style={{ fontSize: 10, color: sub }}>BR</div>
                <div style={{ fontSize: 13, marginTop: 2, fontFamily: "ui-monospace,monospace" }}>{effectiveBr.borrow_no}</div>
              </div>
              <div style={{ padding: "11px 14px" }}>
                <div style={{ fontSize: 10, color: sub }}>Sale</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{sale || editingRequest?.sale || "—"}</div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "รายการ" : "Items"} ({submittedItems.length})</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 10 }}>
              {submittedItems.map(si => {
                const breakdown = breakdownFor(si);
                const primaryColor = breakdown.length === 1 ? breakdown[0].color : "#D4357A";
                return (
                  <div key={si.item_id} style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: sub }}>{si.product_code}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{si.product_name}</div>
                        <div style={{ fontSize: 10, color: sub, marginTop: 3 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{si.price.toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: primaryColor }}>฿{si.totalPrice.toLocaleString()}</div>
                      </div>
                    </div>
                    {/* Breakdown chip row — one chip per non-zero type */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                      {breakdown.map(b => (
                        <span key={b.key} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${b.color}55`, borderRadius: 6, padding: "2px 7px", letterSpacing: 0.3 }}>
                          {b.icon} {b.qty} {typeLabel(b, lang).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {remark && (
              <>
                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "หมายเหตุ" : "Remark"}</div>
                <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#ccc" : "#444", whiteSpace: "pre-line", marginBottom: 10 }}>{remark}</div>
              </>
            )}

            <div style={{ padding: 14, background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมที่จะส่งคำขอ" : "Submit total"}</span>
              <span style={{ fontSize: 18, color: "#D4357A", fontWeight: 700 }}>฿{totalValue.toLocaleString()}</span>
            </div>

            <div style={{ marginTop: 12, padding: "10px 12px", background: dark ? "#1a1500" : "#FEFAEE", border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`, borderRadius: 9, fontSize: 10, color: dark ? "#FAC775" : "#854F0B", lineHeight: 1.55 }}>
              🧪 {lang === "th"
                ? "Test Mode: คำขอจะส่งให้ Backend ด้วย isTest=true และไปแสดงที่ Desktop Admin (🧪 TEST queue) — ไม่กระทบข้อมูล Logistics File"
                : "Test Mode: request POSTs to backend with isTest=true and appears in Desktop Admin (🧪 TEST queue) — no Logistics File writeback"}
            </div>

            {/* Failure banner — shown only after submit() rejects. The
                Sale stays on Step 4 with the same form contents so they
                can retry without re-entering anything. Toast on top of
                the app also fires via window.dispatchEvent. */}
            {submitError && (
              <div style={{
                marginTop: 12, padding: "11px 13px",
                background: "#3D1212", border: "0.5px solid #7A2020",
                borderRadius: 10, color: "#F09595",
                fontSize: 12, fontWeight: 600, lineHeight: 1.55,
              }}>
                ⚠ {submitError}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom action bar */}
      <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
          disabled={submitting}
          style={{ flex: 1, padding: 12, borderRadius: 12, border: `0.5px solid ${bdr}`, background: "transparent", color: sub, fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.5 : 1 }}
        >
          {step === 1 ? (lang === "th" ? "ยกเลิก" : "Cancel") : (lang === "th" ? "← กลับ" : "← Back")}
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={(step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)}
            style={{
              flex: 2, padding: 14, borderRadius: 12, border: "none",
              background: ((step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)) ? "#333" : "#D4357A",
              color: ((step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)) ? "#666" : "#fff",
              fontSize: 14, fontWeight: 700, cursor: ((step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)) ? "not-allowed" : "pointer",
            }}
          >
            {step === 1 ? (lang === "th" ? `เลือก ${selectedIds.size} รายการ →` : `Selected ${selectedIds.size} →`) : (lang === "th" ? "ถัดไป →" : "Next →")}
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              flex: 2, padding: 14, borderRadius: 12, border: "none",
              background: submitting ? "#333" : "#D4357A",
              color: submitting ? "#888" : "#fff",
              fontSize: 14, fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontFamily: "inherit",
            }}
          >
            {submitting && (
              <span style={{
                display: "inline-block", width: 14, height: 14,
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "proto-spin 0.8s linear infinite",
              }}/>
            )}
            {submitting
              ? (lang === "th" ? "กำลังบันทึก..." : "Saving...")
              : isEditing
                ? (lang === "th" ? "↩ ส่งคำขอแก้ไข" : "↩ Resubmit")
                : (lang === "th" ? "✓ ส่งคำขอ" : "✓ Submit")}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

// =============================================================================
// CUSTOMER DETAIL SHEET — with BR list + BR detail + Request Return CTA
// =============================================================================

function CustomerDetailSheet({ customer, onClose, custValues, lang, dark, sale, onProtoSubmitted }) {
  const [brs, setBrs] = useState([]);
  const [loadingBrs, setLoadingBrs] = useState(false);
  const [brSearch, setBrSearch] = useState("");
  const [selectedBR, setSelectedBR] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const card = dark ? "#141414" : "#fff";

  useEffect(() => {
    if (!customer) return;
    setLoadingBrs(true); setBrs([]); setBrSearch(""); setSelectedBR(null);
    fetch(`${API_BASE}/customers/${customer.cust_code}/brs`)
      .then(r => r.json()).then(d => setBrs(Array.isArray(d) ? d : [])).catch(() => setBrs([])).finally(() => setLoadingBrs(false));
  }, [customer]);

  const filteredBRs = brs.filter(br => (!brSearch || br.borrow_no.toLowerCase().includes(brSearch.toLowerCase())));
  const val = custValues[customer?.cust_code];

  return (
    <>
      <BottomSheet open={!!customer} onClose={onClose} height="92%" dark={dark}>
        {customer && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "4px 20px 14px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: sub }}>{lang === "th" ? "ข้อมูลลูกค้า" : "Customer Detail"}</div>
                <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Icon name="close" size={14} color={sub} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 54, height: 54, borderRadius: 13, flexShrink: 0, background: customer.status === "BLOCK" ? "#3D1212" : customer.status === "WARNING" ? "#3D2A00" : "#1A2E0A", color: customer.status === "NORMAL" ? "#C0DD97" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>
                  {customer.customer_name.slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: text, letterSpacing: -0.3 }}>{customer.customer_name}</div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontFamily: "ui-monospace,monospace", background: dark ? "#1a1a1a" : "#f1f0eb", padding: "1px 6px", borderRadius: 4 }}>{customer.cust_code}</span>
                    <TeamPill team={customer.team} size="xs" />
                    <span>Sale: <b style={{ color: text }}>{customer.sale}</b></span>
                  </div>
                  <div style={{ marginTop: 8 }}><StatusPill status={customer.status} size="sm" /></div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
                {[[lang === "th" ? "วันค้างสูงสุด" : "Max Days", customer.max_days + (lang === "th" ? " วัน" : " d"), customer.status], ["BR Active", customer.active_br_count, null], [lang === "th" ? "มูลค่า" : "Value", fmtVal(val), "block"]].map(([l, v, acc], i) => {
                  const a = acc === "BLOCK" || acc === "block" ? { bg: "#2D1010", fg: "#F09595" } : acc === "WARNING" ? { bg: "#2D1E00", fg: "#FAC775" } : null;
                  return <div key={i} style={{ padding: "8px 10px", borderRadius: 9, background: a ? a.bg : (dark ? "#1a1a1a" : "#f5f5f3"), border: `0.5px solid ${a ? a.fg + "44" : bdr}` }}>
                    <div style={{ fontSize: 9, color: a ? a.fg : sub, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: a ? a.fg : text, marginTop: 2 }}>{v}</div>
                  </div>;
                })}
              </div>
            </div>

            {/* Search + BR list */}
            <div style={{ padding: "10px 20px 6px", flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: text, marginBottom: 8 }}>BR List <span style={{ color: sub, fontWeight: 500, fontSize: 11 }}>({brs.length})</span></div>
              {brs.length > 0 && (
                <div style={{ background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
                  <Icon name="search" size={14} color={sub} />
                  <input value={brSearch} onChange={e => setBrSearch(e.target.value)} placeholder={lang === "th" ? "ค้นหาเลข BR..." : "Search BR..."} style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "8px", fontSize: 12, color: text }} />
                </div>
              )}
            </div>
            <div style={{ padding: "0 20px 20px", flex: 1, overflowY: "auto" }}>
              {loadingBrs ? (
                <div style={{ padding: 32, textAlign: "center", fontSize: 12, color: sub }}>{lang === "th" ? "กำลังโหลด BR..." : "Loading BR..."}</div>
              ) : filteredBRs.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", fontSize: 12, color: sub }}>{lang === "th" ? "ยังไม่มี BR" : "No BR data"}</div>
              ) : filteredBRs.map(br => {
                const total = (br.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
                const daysCol = br.days_borrowed > 180 ? (dark ? "#F09595" : "#A32D2D") : br.days_borrowed > 90 ? (dark ? "#FAC775" : "#854F0B") : text;
                const rowBg = br.borrow_alert === "BLOCK" ? (dark ? "#1A0A0A" : "#FEF5F5") : br.borrow_alert === "WARNING" ? (dark ? "#1A1400" : "#FEFAEE") : card;
                return (
                  <div key={br.borrow_no} onClick={() => setSelectedBR(br)} style={{ background: rowBg, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: "11px 12px", marginBottom: 7, cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{br.borrow_no}</span>
                      <StatusPill status={br.borrow_alert || "NORMAL"} size="xs" />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: sub }}>
                      <span>📅 {br.borrow_date} · <b style={{ color: daysCol, fontWeight: 600 }}>{br.days_borrowed} {lang === "th" ? "วัน" : "d"}</b> · {(br.items || []).length} {lang === "th" ? "รายการ" : "items"}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: text }}>{fmtFull(total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* BR Detail Sheet with Request Return CTA */}
      <BottomSheet open={!!selectedBR} onClose={() => setSelectedBR(null)} height="86%" dark={dark}>
        {selectedBR && (() => {
          const total = (selectedBR.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
          return (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div style={{ padding: "4px 20px 14px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <button onClick={() => setSelectedBR(null)} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "#D4357A", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                    <Icon name="chevron" size={14} color="#D4357A" />
                    <span style={{ transform: "scaleX(-1)", display: "inline-block" }}>{lang === "th" ? " กลับ" : " Back"}</span>
                  </button>
                  <button
                    onClick={() => setRequestOpen(true)}
                    style={{
                      background: "linear-gradient(135deg, #D4357A 0%, #9A1A56 100%)",
                      border: "none", color: "#fff",
                      padding: "7px 14px", borderRadius: 9,
                      fontSize: 11, fontWeight: 700,
                      display: "inline-flex", alignItems: "center", gap: 5,
                      cursor: "pointer", boxShadow: "0 4px 12px rgba(212,53,122,0.3)",
                    }}
                  >
                    <Icon name="returns" size={13} color="#fff" />
                    {lang === "th" ? "ขอคืนสินค้า" : "Request Return"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: sub, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เลขที่ใบยืม" : "Borrow No."}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: text, fontFamily: "ui-monospace,monospace", marginBottom: 8 }}>{selectedBR.borrow_no}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 11, color: sub }}>
                  <span>{selectedBR.borrow_date}</span>·
                  <span style={{ fontWeight: 600, color: selectedBR.days_borrowed > 180 ? (dark ? "#F09595" : "#A32D2D") : selectedBR.days_borrowed > 90 ? (dark ? "#FAC775" : "#854F0B") : text }}>{selectedBR.days_borrowed} {lang === "th" ? "วัน" : "days"}</span>·
                  <StatusPill status={selectedBR.borrow_alert || "NORMAL"} size="sm" />
                </div>
              </div>
              <div style={{ padding: "12px 20px 20px", flex: 1, overflowY: "auto" }}>
                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{(selectedBR.items || []).length} {lang === "th" ? "รายการสินค้า" : "Items"}</div>
                {(selectedBR.items || []).map((item, i) => (
                  <div key={item.item_id || i} style={{ padding: "12px 0", borderBottom: i < (selectedBR.items || []).length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: sub, fontFamily: "ui-monospace,monospace" }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: sub, fontFamily: "ui-monospace,monospace", marginBottom: 3 }}>{item.product_code}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>{item.product_name}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: sub }}>{item.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{item.price.toLocaleString()}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: text }}>฿{(item.price * item.quantity).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 14, padding: 14, background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมทั้งหมด" : "Grand Total"}</div>
                  <div style={{ fontSize: 18, color: "#D4357A", fontWeight: 700 }}>฿{total.toLocaleString()}</div>
                </div>
                {selectedBR.remark && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: sub, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Remark</div>
                    <div style={{ fontSize: 13, color: text, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${bdr}`, borderRadius: 9, padding: "10px 12px" }}>{selectedBR.remark}</div>
                  </div>
                )}
                {/* PDF Export — same read-only endpoint the production MobileApp uses.
                    GET /brs/{borrow_no}/pdf returns a PDF blob; no DB writes, no Sheet
                    writes, no Apps Script. Safe inside the prototype's isolation. */}
                <button
                  onClick={() => window.open(`${API_BASE}/brs/${selectedBR.borrow_no}/pdf`, "_blank")}
                  style={{ marginTop: 12, width: "100%", padding: "13px", borderRadius: 11, border: "none", background: "#D4357A", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M2 13h12v1.5H2V13zm6-2L4.5 7.5l1.1-1.1 1.65 1.65V2h1.5v6.05l1.65-1.65L11.5 7.5 8 11z"/></svg>
                  Export PDF
                </button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      <RequestReturnSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        br={selectedBR}
        customer={customer}
        sale={sale}
        lang={lang}
        dark={dark}
        onSubmitted={(newReq) => {
          // Close the request sheet and the BR detail. The customer detail
          // will be closed by the parent (MobilePrototypeApp) so the
          // full-screen success view can take over.
          setRequestOpen(false);
          setSelectedBR(null);
          if (onProtoSubmitted) onProtoSubmitted(newReq);
        }}
      />
    </>
  );
}

// =============================================================================
// DATE RANGE PICKER (hotel-app style calendar, themed to our dark/pink UI)
// =============================================================================
// Replaces the small "Today / 7d / 30d" chip row with a proper calendar that
// the user opens in a bottom sheet. Selects an inclusive from..to range
// (or a single day when only "from" is picked). Theming uses the prototype's
// existing card / pink / dark palette so it matches every other screen.

function DateRangePickerSheet({ open, onClose, from, to, onApply, dark, lang }) {
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);
  // Refs used to auto-scroll the calendar to the current month when the sheet
  // opens, so the user starts near today instead of 11 months in the past.
  // Current month is NOT auto-selected — only scrolled into view.
  const scrollRef = useRef(null);
  const currentMonthRef = useRef(null);

  useEffect(() => {
    if (open) {
      setLocalFrom(from);
      setLocalTo(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // After the bottom sheet finishes mounting, snap the scroll container so the
  // current month's heading is near the top of the visible calendar area.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const target = currentMonthRef.current;
      if (!scroller || !target) return;
      try {
        // Align the current-month block near the top of the scroller, leaving
        // a few pixels above so the previous month's tail stays peekable.
        const offset = target.offsetTop - 8;
        scroller.scrollTo({ top: offset, behavior: "auto" });
      } catch {
        // Fallback for very old WebViews
        try { scroller.scrollTop = target.offsetTop - 8; } catch {}
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  // 11 months back + current + 1 forward — adjust if the dataset goes deeper
  const months = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = -11; i <= 1; i++) {
      out.push(new Date(now.getFullYear(), now.getMonth() + i, 1));
    }
    return out;
  }, [open]);

  const today = startOfDay(new Date());
  const currentMonthIdx = months.findIndex(m =>
    m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth()
  );

  function pickDate(d) {
    const day = startOfDay(d);
    if (!localFrom || (localFrom && localTo)) {
      // No selection yet, OR both already set — start a fresh range
      setLocalFrom(day);
      setLocalTo(null);
    } else {
      // Have from, no to yet
      if (day.getTime() < localFrom.getTime()) {
        // User clicked an earlier date — restart from there
        setLocalFrom(day);
        setLocalTo(null);
      } else {
        // Set the end (can equal from for a single-day range)
        setLocalTo(day);
      }
    }
  }

  function inBetween(d) {
    if (!localFrom || !localTo) return false;
    const t = d.getTime();
    return t > localFrom.getTime() && t < localTo.getTime();
  }

  const dayHeaders = lang === "th" ? THAI_DAY_HEADERS : EN_DAY_HEADERS;
  const monthsLabels = lang === "th" ? THAI_MONTHS_SHORT : EN_MONTHS_SHORT;
  const daysCount = (localFrom && localTo)
    ? Math.round((localTo - localFrom) / 86400000) + 1
    : (localFrom ? 1 : 0);

  return (
    <BottomSheet open={open} onClose={onClose} height="92%" dark={dark}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {/* Header: close + title + clear */}
        <div style={{ padding: "4px 20px 12px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Icon name="close" size={14} color={sub} />
            </button>
            <div style={{ fontSize: 15, fontWeight: 700, color: text }}>{lang === "th" ? "เลือกวันที่" : "Select date"}</div>
            <button
              onClick={() => { setLocalFrom(null); setLocalTo(null); }}
              disabled={!localFrom && !localTo}
              style={{ fontSize: 12, color: (localFrom || localTo) ? "#D4357A" : sub, background: "transparent", border: "none", cursor: (localFrom || localTo) ? "pointer" : "default", fontWeight: 600, padding: 4, fontFamily: "inherit", opacity: (localFrom || localTo) ? 1 : 0.5 }}
            >
              {lang === "th" ? "ล้าง" : "Clear"}
            </button>
          </div>

          {/* From / To summary pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, padding: "9px 12px", borderRadius: 10, background: localFrom ? "#2D0F1A" : (dark ? "#1a1a1a" : "#f5f5f3"), border: `1px solid ${localFrom ? "#D4357A" : bdr}` }}>
              <div style={{ fontSize: 9, color: sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{lang === "th" ? "เริ่มต้น" : "From"}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: localFrom ? "#D4357A" : sub, marginTop: 3 }}>
                {localFrom ? fmtDayMonth(localFrom, lang) : (lang === "th" ? "เลือกวัน" : "Select")}
              </div>
            </div>
            <Icon name="chevron" size={14} color={sub} />
            <div style={{ flex: 1, padding: "9px 12px", borderRadius: 10, background: localTo ? "#2D0F1A" : (dark ? "#1a1a1a" : "#f5f5f3"), border: `1px solid ${localTo ? "#D4357A" : bdr}` }}>
              <div style={{ fontSize: 9, color: sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{lang === "th" ? "สิ้นสุด" : "To"}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: localTo ? "#D4357A" : sub, marginTop: 3 }}>
                {localTo ? fmtDayMonth(localTo, lang) : (lang === "th" ? "เลือกวัน" : "Select")}
              </div>
            </div>
          </div>
        </div>

        {/* Day-of-week strip — sticky-looking via top of scroll area */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "10px 16px", flexShrink: 0, borderBottom: `0.5px solid ${bdr}`, background: dark ? "#0a0a0a" : "#fafaf8" }}>
          {dayHeaders.map((h, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 10, color: sub, fontWeight: 600, letterSpacing: 0.3 }}>{h}</div>
          ))}
        </div>

        {/* Months list — scrollable */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "8px 16px 20px" }}>
          {months.map((monthDate, mIdx) => {
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const firstDayOfWeek = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const cells = [];
            for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

            return (
              <div
                key={mIdx}
                ref={mIdx === currentMonthIdx ? currentMonthRef : null}
                style={{ marginBottom: 18 }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: text, textAlign: "center", margin: "12px 0 10px" }}>
                  {monthsLabels[month]} {lang === "th" ? year + 543 : year}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                  {cells.map((d, idx) => {
                    if (!d) return <div key={idx} style={{ height: 44 }} />;
                    const isT     = sameDay(d, today);
                    const isStart = sameDay(d, localFrom);
                    const isEnd   = sameDay(d, localTo);
                    const between = inBetween(d);
                    const hasRange = !!(localFrom && localTo && !sameDay(localFrom, localTo));
                    // A continuous range band is rendered behind the day pill
                    // when the cell is between, or is the start/end of a
                    // multi-day range. The band has rounded ends at the start
                    // and end cells so the overall range reads as a soft pill.
                    const showBand = between || (hasRange && (isStart || isEnd));
                    // Light pink fill + slightly darker pink top/bottom edges
                    // so the band is visible but never washes out the digits.
                    const bandFill   = dark ? "rgba(212, 53, 122, 0.16)" : "rgba(212, 53, 122, 0.12)";
                    const bandEdge   = dark ? "rgba(212, 53, 122, 0.36)" : "rgba(212, 53, 122, 0.32)";
                    return (
                      <button
                        key={idx}
                        onClick={() => pickDate(d)}
                        style={{
                          position: "relative",
                          height: 44, padding: 0, border: "none", cursor: "pointer",
                          background: "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "inherit",
                        }}
                      >
                        {showBand && (
                          <div
                            aria-hidden
                            style={{
                              position: "absolute",
                              top: 4, bottom: 4,
                              left:  isStart && hasRange ? "50%" : 0,
                              right: isEnd   && hasRange ? "50%" : 0,
                              background: bandFill,
                              borderTop:    `1px solid ${bandEdge}`,
                              borderBottom: `1px solid ${bandEdge}`,
                              borderLeft:  isStart && hasRange ? `1px solid ${bandEdge}` : "none",
                              borderRight: isEnd   && hasRange ? `1px solid ${bandEdge}` : "none",
                              borderTopLeftRadius:     isStart && hasRange ? 999 : 0,
                              borderBottomLeftRadius:  isStart && hasRange ? 999 : 0,
                              borderTopRightRadius:    isEnd   && hasRange ? 999 : 0,
                              borderBottomRightRadius: isEnd   && hasRange ? 999 : 0,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        <div
                          style={{
                            position: "relative",
                            zIndex: 1,
                            width: 36, height: 36, borderRadius: "50%",
                            background: (isStart || isEnd) ? "#D4357A" : "transparent",
                            color: (isStart || isEnd) ? "#fff" : (between ? "#D4357A" : (isT ? "#D4357A" : text)),
                            fontSize: 13,
                            fontWeight: (isStart || isEnd || isT) ? 700 : 500,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            border: (isT && !isStart && !isEnd && !between) ? `1px solid #D4357A` : "none",
                            boxShadow: (isStart || isEnd) ? "0 2px 8px rgba(212,53,122,0.35)" : "none",
                          }}
                        >
                          {d.getDate()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Apply button */}
        <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, flexShrink: 0 }}>
          <button
            onClick={() => { onApply(localFrom, localTo); onClose(); }}
            disabled={!localFrom}
            style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none",
              background: localFrom ? "#D4357A" : "#333",
              color: localFrom ? "#fff" : "#666",
              fontSize: 14, fontWeight: 700,
              cursor: localFrom ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            {!localFrom ? (lang === "th" ? "เลือกวันที่" : "Select date")
              : !localTo ? (lang === "th" ? `ตกลง (${fmtShortDate(localFrom, lang)})` : `Apply (${fmtShortDate(localFrom, lang)})`)
              : (lang === "th" ? `ตกลง (${daysCount} วัน)` : `Apply (${daysCount} days)`)}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// =============================================================================
// ADMIN FEEDBACK COMPOSER (prototype-only)
// =============================================================================
//
// Replaces the one-tap "rejected" status flip in the admin sim. Mirrors the
// Desktop reviewer flow at br-return.html:3231-3347:
//   - Per-item "needs revision" toggle with per-item reason text
//   - Global admin remark
//   - Photo attachments via real file picker (compressed to base64) plus a
//     "demo photo" generator for quick demos
//   - "Send back to Sale" applies the rejection to the existing record via
//     replaceProtoReturn — same id, status → rejected
//
// Storage isolation: every byte of attachment data stays inside
// localStorage["borrow-control:prototype-mobile-returns"]. No POST to
// /return-requests, no script.google.com, no /sync writes.

function AdminFeedbackComposer({ open, request, onClose, onApply, onOpenLightbox, dark, lang }) {
  const [rejectMap, setRejectMap] = useState({}); // item-key -> { rejected: bool, reason: string }
  const [adminNote, setAdminNote] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const fileInputRef = useRef(null);

  // Derive a stable key per submitted item so toggles survive renders.
  const itemKey = (si) => si.item_id || `${si.product_code || si.code}-${si.line_no || si.lineNo || ""}`;

  useEffect(() => {
    if (!open || !request) return;
    // Reset state, then pre-populate from any prior rejection so the
    // composer feels like "continue editing" if the same request is
    // re-flagged. Pre-existing rejectedItems and attachments come back in
    // so the reviewer can refine, not start from scratch.
    setAdminNote(request.adminNote || "");
    setAttachments(Array.isArray(request.attachments) ? [...request.attachments] : []);
    const next = {};
    const prevRejected = Array.isArray(request.rejectedItems) ? request.rejectedItems : [];
    for (const si of (request.submittedItems || [])) {
      const key = itemKey(si);
      const prior = prevRejected.find(r =>
        (r.itemId && r.itemId === si.item_id)
        || ((r.code || r.product_code) === si.product_code && (r.lineNo || r.line_no) === si.line_no)
      );
      next[key] = { rejected: !!prior, reason: prior?.reason || "" };
    }
    setRejectMap(next);
    setErrMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request?.id]);

  if (!open || !request) return null;

  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const submittedItems = Array.isArray(request.submittedItems) ? request.submittedItems : [];
  const rejectedCount = submittedItems.filter(si => rejectMap[itemKey(si)]?.rejected).length;
  const totalAttachmentBytes = attachments.reduce((s, a) => s + approxAttachmentBytes(a), 0);

  function toggleItemReject(si) {
    const key = itemKey(si);
    setRejectMap(prev => {
      const cur = prev[key] || { rejected: false, reason: "" };
      return { ...prev, [key]: { ...cur, rejected: !cur.rejected } };
    });
  }
  function setItemReason(si, reason) {
    const key = itemKey(si);
    setRejectMap(prev => ({ ...prev, [key]: { ...(prev[key] || { rejected: false }), reason } }));
  }

  function addAttachment(att) {
    setAttachments(prev => {
      if (prev.length >= PHOTO_MAX_PER_REQUEST) {
        setErrMsg(lang === "th"
          ? `แนบได้สูงสุด ${PHOTO_MAX_PER_REQUEST} รูปต่อคำขอ`
          : `Max ${PHOTO_MAX_PER_REQUEST} photos per request`);
        return prev;
      }
      setErrMsg("");
      return [...prev, att];
    });
  }
  function removeAttachment(idx) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBusy(true); setErrMsg("");
    // Slice the picker batch to whatever cap is left before we even decode.
    const room = Math.max(0, PHOTO_MAX_PER_REQUEST - attachments.length);
    const accepted = files.slice(0, room);
    if (accepted.length < files.length) {
      setErrMsg(lang === "th"
        ? `แนบได้สูงสุด ${PHOTO_MAX_PER_REQUEST} รูปต่อคำขอ`
        : `Max ${PHOTO_MAX_PER_REQUEST} photos per request`);
    }
    try {
      for (const f of accepted) {
        try {
          const att = await compressImageFile(f);
          // Re-check via functional setter so we never exceed the cap even
          // if multiple decodes race with each other.
          setAttachments(prev => prev.length >= PHOTO_MAX_PER_REQUEST ? prev : [...prev, att]);
        } catch (err) {
          setErrMsg(lang === "th" ? `ไฟล์ "${f.name}" ใช้ไม่ได้` : `Could not process "${f.name}"`);
        }
      }
    } finally {
      setBusy(false);
      // Reset the input so picking the same file twice still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDemoPhoto() {
    if (attachments.length >= PHOTO_MAX_PER_REQUEST) {
      setErrMsg(lang === "th"
        ? `แนบได้สูงสุด ${PHOTO_MAX_PER_REQUEST} รูปต่อคำขอ`
        : `Max ${PHOTO_MAX_PER_REQUEST} photos per request`);
      return;
    }
    addAttachment(genDemoPhoto(attachments.length));
  }

  function handleSend() {
    const reasonsByKey = rejectMap;
    const rejectedItems = submittedItems
      .filter(si => reasonsByKey[itemKey(si)]?.rejected)
      .map(si => {
        const code = si.code || si.product_code;
        const name = si.name || si.product_name;          // ← read either shape
        const itemId = si.itemId || si.item_id;
        const lineNo = si.lineNo || si.line_no;
        return {
          // Desktop-canonical:
          code,
          name,
          price: Number(si.price) || 0,
          quantity: Number(si.quantity) || 0,
          totalPrice: Number(si.totalPrice) || 0,
          retQty:  Number(si.retQty)  || 0,
          clmQty:  Number(si.clmQty)  || 0,
          saleQty: Number(si.saleQty) || 0,
          freeQty: Number(si.freeQty) || 0,
          reason: (reasonsByKey[itemKey(si)]?.reason || "").trim(),
          itemId,
          lineNo,
          lineKey: `line:${lineNo}|code:${code}`,
          // Mobile aliases for our own renderers:
          product_code: code,
          product_name: name,
          item_id: itemId,
          line_no: lineNo,
        };
      });
    if (rejectedItems.length === 0) {
      setErrMsg(lang === "th"
        ? "เลือกอย่างน้อย 1 รายการที่ต้องแก้"
        : "Pick at least one item to flag");
      return;
    }
    // Try the write; if localStorage is too full, surface a clear message.
    try {
      onApply({
        adminNote: adminNote.trim(),
        rejectedItems,
        attachments,
      });
    } catch (e) {
      setErrMsg(lang === "th"
        ? "พื้นที่ไม่พอ ลดรูปหรือลบรูปก่อน"
        : "Storage full — remove a photo or reduce size");
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} height="94%" dark={dark}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "4px 20px 12px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: STATUS_META.rejected.color, letterSpacing: 0.3 }}>
                🎭 {lang === "th" ? "จำลอง Admin · ส่งกลับแก้ไข" : "Sim Admin · Send back"}
              </div>
              <PrototypeBadge />
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Icon name="close" size={14} color={sub} />
            </button>
          </div>
          <div style={{ fontSize: 11, color: sub, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "ui-monospace,monospace", color: text, fontWeight: 600 }}>{request.id}</span>·
            <span>{request.cust}</span>·
            <span style={{ fontFamily: "ui-monospace,monospace" }}>{request.br}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px", color: text }}>
          {/* Per-item rejection rows */}
          <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
            {lang === "th" ? `เลือกรายการที่ต้องแก้ (${rejectedCount}/${submittedItems.length})` : `Select items to flag (${rejectedCount}/${submittedItems.length})`}
          </div>
          {submittedItems.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: sub, fontSize: 12 }}>
              {lang === "th" ? "คำขอนี้ไม่มีรายการ" : "No items in this request"}
            </div>
          ) : submittedItems.map(si => {
            const key = itemKey(si);
            const st = rejectMap[key] || { rejected: false, reason: "" };
            const tb = breakdownFor(si);
            return (
              <div key={key} style={{
                background: card,
                border: `1px solid ${st.rejected ? STATUS_META.rejected.border : bdr}`,
                borderRadius: 12, padding: "11px 13px", marginBottom: 8,
                boxShadow: st.rejected ? `0 0 0 1px ${STATUS_META.rejected.border}` : "none",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <button
                    onClick={() => toggleItemReject(si)}
                    style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2,
                      border: `1.5px solid ${st.rejected ? STATUS_META.rejected.color : "rgba(255,255,255,0.15)"}`,
                      background: st.rejected ? STATUS_META.rejected.color : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", padding: 0,
                    }}
                  >
                    {st.rejected && <Icon name="check" size={14} color="#1a1a1a" />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: sub, fontFamily: "ui-monospace,monospace" }}>{si.product_code || si.code}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1, color: text }}>{si.product_name}</div>
                    {tb.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                        {tb.map(b => (
                          <span key={b.key} style={{ fontSize: 9, fontWeight: 700, color: b.color, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${b.color}55`, borderRadius: 5, padding: "1px 6px", letterSpacing: 0.3 }}>
                            {b.icon} {b.qty} {typeLabel(b, lang).toUpperCase()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {st.rejected && (
                  <textarea
                    value={st.reason}
                    onChange={(e) => setItemReason(si, e.target.value.slice(0, 240))}
                    placeholder={lang === "th" ? "ระบุเหตุผลที่ต้องแก้ไข..." : "Reason this item needs revision..."}
                    style={{
                      width: "100%", marginTop: 8, minHeight: 56,
                      borderRadius: 8, padding: "8px 10px",
                      background: dark ? "#0a0a0a" : "#fafaf8",
                      border: `0.5px solid ${STATUS_META.rejected.border}`,
                      color: text, fontFamily: "inherit", fontSize: 12, lineHeight: 1.5,
                      resize: "none", outline: "none",
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Global admin remark */}
          <div style={{ fontSize: 11, color: sub, marginTop: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
            {lang === "th" ? "หมายเหตุ Admin (ทั้งคำขอ)" : "Admin remark (whole request)"}
          </div>
          <textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value.slice(0, 500))}
            maxLength={500}
            placeholder={lang === "th" ? "ระบุภาพรวมที่ Sale ต้องแก้ไข..." : "Overall message Sale should see..."}
            style={{
              width: "100%", minHeight: 90, borderRadius: 12, padding: "12px 14px",
              background: card, border: `0.5px solid ${bdr}`,
              color: text, fontFamily: "inherit", fontSize: 13, lineHeight: 1.55,
              resize: "none", outline: "none",
            }}
          />
          <div style={{ textAlign: "right", fontSize: 10, color: sub, marginTop: 4 }}>{adminNote.length} / 500</div>

          {/* Attachments */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
              📷 {lang === "th" ? `หลักฐาน (${attachments.length}/${PHOTO_MAX_PER_REQUEST})` : `Evidence (${attachments.length}/${PHOTO_MAX_PER_REQUEST})`}
            </div>
            <div style={{ fontSize: 9, color: sub }}>
              {(totalAttachmentBytes / 1024).toFixed(0)} KB
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || attachments.length >= PHOTO_MAX_PER_REQUEST}
              style={{
                flex: 1, padding: 11, borderRadius: 10,
                border: `0.5px solid ${bdr}`,
                background: dark ? "#1a1a1a" : "#fafaf8",
                color: attachments.length >= PHOTO_MAX_PER_REQUEST ? sub : text,
                fontSize: 12, fontWeight: 600,
                cursor: (busy || attachments.length >= PHOTO_MAX_PER_REQUEST) ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1, fontFamily: "inherit",
              }}
            >
              📷 {busy ? (lang === "th" ? "กำลังประมวลผล..." : "Processing...") : (lang === "th" ? "เลือกรูป" : "Pick image")}
            </button>
            <button
              onClick={handleDemoPhoto}
              disabled={attachments.length >= PHOTO_MAX_PER_REQUEST}
              style={{
                flex: 1, padding: 11, borderRadius: 10,
                border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`,
                background: "transparent",
                color: dark ? "#FAC775" : "#854F0B",
                fontSize: 12, fontWeight: 600,
                cursor: attachments.length >= PHOTO_MAX_PER_REQUEST ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              🎨 {lang === "th" ? "รูปจำลอง" : "Demo photo"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </div>

          {attachments.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {attachments.map((att, i) => (
                <div key={i} style={{ position: "relative", aspectRatio: "1 / 1" }}>
                  <button
                    onClick={() => onOpenLightbox && onOpenLightbox(attachments, i)}
                    style={{
                      width: "100%", height: "100%", padding: 0,
                      border: `0.5px solid ${bdr}`, borderRadius: 9,
                      background: dark ? "#0a0a0a" : "#fafaf8",
                      cursor: "pointer", overflow: "hidden",
                    }}
                  >
                    <img src={att.data} alt={att.name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAttachment(i); }}
                    style={{
                      position: "absolute", top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 11,
                      border: "none", background: "rgba(0,0,0,0.7)", color: "#fff",
                      fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >✕</button>
                  {att._demo && (
                    <span style={{ position: "absolute", bottom: 4, left: 4, fontSize: 8, fontWeight: 700, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "1px 5px", borderRadius: 4, letterSpacing: 0.3 }}>DEMO</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {errMsg && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 8, fontSize: 11, color: STATUS_META.rejected.color }}>
              ⚠ {errMsg}
            </div>
          )}

          <div style={{ marginTop: 14, padding: "10px 12px", background: dark ? "#1a1500" : "#FEFAEE", border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`, borderRadius: 9, fontSize: 10, color: dark ? "#FAC775" : "#854F0B", lineHeight: 1.55 }}>
            ⚠ {lang === "th"
              ? "Prototype: รูปและหมายเหตุนี้เก็บใน localStorage บนเครื่องเท่านั้น — ไม่ส่งไป Admin/Database จริง"
              : "Prototype: Photos and notes are stored in localStorage only — not sent to real Admin/DB"}
          </div>
        </div>

        {/* Bottom action bar */}
        <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, border: `0.5px solid ${bdr}`, background: "transparent", color: sub, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {lang === "th" ? "ยกเลิก" : "Cancel"}
          </button>
          <button
            onClick={handleSend}
            disabled={rejectedCount === 0}
            style={{
              flex: 2, padding: 14, borderRadius: 12, border: "none",
              background: rejectedCount === 0 ? "#333" : STATUS_META.rejected.border,
              color: rejectedCount === 0 ? "#666" : "#fff",
              fontSize: 14, fontWeight: 700,
              cursor: rejectedCount === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            ↩ {lang === "th" ? `ส่งกลับให้ Sale (${rejectedCount})` : `Send back to Sale (${rejectedCount})`}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// =============================================================================
// RETURNS SCREEN (new bottom tab)
// =============================================================================

function ReturnsScreen({ lang, dark, sale, returns, refreshReturns, setReturnsCount }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(null);   // Date | null — inclusive start of range
  const [dateTo, setDateTo]     = useState(null);   // Date | null — inclusive end of range
  const [dateOpen, setDateOpen] = useState(false);  // calendar sheet visibility
  const [selectedReq, setSelectedReq] = useState(null);
  const [simReq, setSimReq] = useState(null); // for admin sim long-press
  // ── Correction-flow state (prototype-only) ──────────────────────────
  // composerReq: when set, the AdminFeedbackComposer opens to compose a
  //   per-item rejection + admin note + attachments for that request.
  // editingReq: when set, RequestReturnSheet opens in edit-and-resubmit
  //   mode pre-loaded from that rejected request.
  // lightboxImages / lightboxStart: opens the fullscreen ImageLightbox.
  // editToast: brief on-screen confirmation after a successful resubmit.
  const [composerReq, setComposerReq] = useState(null);
  const [editingReq, setEditingReq]   = useState(null);
  const [lightboxImages, setLightboxImages] = useState(null);
  const [lightboxStart,  setLightboxStart]  = useState(0);
  const [editToast, setEditToast] = useState(null);
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  // Show only this Sale's returns
  const mine = useMemo(() => returns.filter(r => (r.sale || "").toUpperCase() === (sale || "").toUpperCase()), [returns, sale]);

  useEffect(() => { if (setReturnsCount) setReturnsCount(mine.filter(r => r.status === "pending").length); }, [mine, setReturnsCount]);

  const counts = {
    pending:   mine.filter(r => r.status === "pending").length,
    approved:  mine.filter(r => r.status === "approved").length,
    rejected:  mine.filter(r => r.status === "rejected").length,
    cancelled: mine.filter(r => r.status === "cancelled").length,
  };

  // Inclusive date bounds: [dateFrom 00:00, dateTo 23:59:59.999].
  // When only dateFrom is set, treats it as a single-day filter (00:00 → 23:59).
  const fromTs = dateFrom ? dateFrom.getTime() : null;
  const toTs   = dateTo
    ? (dateTo.getTime() + 86400000 - 1)
    : (dateFrom ? (dateFrom.getTime() + 86400000 - 1) : null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mine
      .filter(r =>
        (!q || (r.id || "").toLowerCase().includes(q) || (r.cust || "").toLowerCase().includes(q) || (r.br || "").toLowerCase().includes(q)) &&
        (!statusFilter || r.status === statusFilter) &&
        (fromTs == null || ((Number(r.dateSort) || 0) >= fromTs && (Number(r.dateSort) || 0) <= toTs))
      )
      .sort((a, b) => (Number(b.dateSort) || 0) - (Number(a.dateSort) || 0));
  }, [mine, search, statusFilter, fromTs, toTs]);

  const hasAnyFilter = !!(search || statusFilter || dateFrom);

  function simulateStatusChange(req, newStatus) {
    // The "rejected" path now opens the AdminFeedbackComposer so the
    // reviewer can pick which items fail, write per-item reasons, attach
    // photos, and write a global admin remark — matching the Desktop flow
    // at br-return.html:3231-3347. All other statuses remain one-tap.
    if (newStatus === "rejected") {
      setSimReq(null);
      setComposerReq(req);
      return;
    }
    const updated = { ...req, status: newStatus };
    if (newStatus === "approved") {
      updated.sheetSync = "synced";
      updated.sheetSyncAt = new Date().toISOString();
      // Approving clears any prior rejection state so the request becomes
      // truly clean. revisionHistory is retained as audit trail.
      updated.adminNote = "";
      updated.rejectedItems = [];
      updated.attachments = [];
    }
    if (newStatus === "cancelled") {
      updated.cancelReason = "(Simulated) request cancelled.";
    }
    if (newStatus === "pending") {
      updated.adminNote = "";
      updated.rejectedItems = [];
      updated.attachments = [];
    }
    upsertProtoReturn(updated);
    refreshReturns();
    setSimReq(null);
  }

  // Called by the composer when the reviewer hits "Send back to Sale".
  // Writes the full rejection payload onto the existing record without
  // changing its id (Desktop parity).
  function applyAdminRejection(req, payload) {
    const updated = replaceProtoReturn(req.id, {
      status: "rejected",
      adminNote: payload.adminNote || "",
      rejectedItems: payload.rejectedItems || [],
      attachments: payload.attachments || [],
      // Don't bump dateSort — Admin actions should not push the request
      // to the top of the Sale's list; the Sale already saw it. Only the
      // Sale's resubmit bumps dateSort.
    });
    refreshReturns();
    setComposerReq(null);
    if (selectedReq && selectedReq.id === req.id) {
      setSelectedReq(updated || { ...req, ...(payload || {}) });
    }
  }

  function deleteRequest(req) {
    const list = loadProtoReturns().filter(r => r.id !== req.id);
    saveProtoReturns(list);
    refreshReturns();
    setSimReq(null);
    setSelectedReq(null);
  }

  return (
    <div style={{ color: text, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* KPI strip */}
      <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
        {/* KPI strip — tap a card to filter by that status (toggleable).
            Label uses sub-foreground for high contrast, count uses primary
            text color, and a small colored dot + tinted bg when selected
            keep the status identity visible without sacrificing legibility. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
          {[
            ["pending", counts.pending, STATUS_META.pending],
            ["approved", counts.approved, STATUS_META.approved],
            ["rejected", counts.rejected, STATUS_META.rejected],
            ["cancelled", counts.cancelled, STATUS_META.cancelled],
          ].map(([k, n, m]) => {
            const isActive = statusFilter === k;
            return (
              <button
                key={k}
                onClick={() => setStatusFilter(isActive ? "" : k)}
                style={{
                  background: isActive ? m.bg : card,
                  border: `1px solid ${isActive ? m.color : bdr}`,
                  borderRadius: 10, padding: "10px 6px", textAlign: "center",
                  cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.12s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: isActive ? m.color : (dark ? "#ccc" : "#444"), letterSpacing: 0.3 }}>
                    {lang === "th" ? m.label_short_th : m.label_en}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: isActive ? m.color : text, lineHeight: 1 }}>{n}</div>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
          <Icon name="search" size={14} color={sub} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === "th" ? "ค้นหา RT / ลูกค้า / BR..." : "Search RT / customer / BR..."} style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "8px", fontSize: 12, color: text }} />
          {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", color: sub, cursor: "pointer", padding: 4 }}><Icon name="close" size={12} color={sub} /></button>}
        </div>

        {/* Status filter is now driven entirely by the KPI cards above —
            tap a card to filter, tap again to clear. The redundant chip
            row that used to live here has been removed per user feedback. */}

        {/* Date filter trigger — opens the calendar bottom sheet.
            Shows the selected range inline, or "ทุกวันที่" when empty. */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <button
            onClick={() => setDateOpen(true)}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              padding: "9px 12px", borderRadius: 10,
              border: `1px solid ${dateFrom ? "#D4357A" : bdr}`,
              background: dateFrom ? "#2D0F1A" : card,
              color: dateFrom ? "#D4357A" : sub,
              fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            }}
          >
            <Icon name="calendar" size={14} color={dateFrom ? "#D4357A" : sub} />
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {!dateFrom
                ? (lang === "th" ? "ทุกวันที่" : "Any date")
                : (dateTo && !sameDay(dateFrom, dateTo))
                  ? `${fmtShortDate(dateFrom, lang)} → ${fmtShortDate(dateTo, lang)}`
                  : fmtShortDate(dateFrom, lang)}
            </span>
            {dateFrom && (
              <span
                onClick={(e) => { e.stopPropagation(); setDateFrom(null); setDateTo(null); }}
                style={{ padding: "0 4px", cursor: "pointer", color: sub, fontSize: 14, lineHeight: 1 }}
              >✕</span>
            )}
          </button>
          {hasAnyFilter && (
            <button onClick={() => { setSearch(""); setStatusFilter(""); setDateFrom(null); setDateTo(null); }} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, borderRadius: 10, flexShrink: 0, border: `0.5px dashed rgba(255,255,255,0.15)`, background: "transparent", color: sub, cursor: "pointer" }}>
              {lang === "th" ? "ล้างตัวกรอง" : "Clear"}
            </button>
          )}
        </div>

        <div style={{ fontSize: 10, color: sub, marginTop: 8 }}>
          {filtered.length} {lang === "th" ? "รายการ" : "results"}
          {isTestMode()
            ? " · " + (lang === "th" ? "🧪 เชื่อม Backend จริง — Admin ใช้งาน Desktop" : "🧪 Connected to backend — review on Desktop")
            : " · " + (lang === "th" ? "แตะค้างเพื่อจำลองสถานะ Admin" : "Long-press to simulate Admin")}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: sub, fontSize: 12, lineHeight: 1.6 }}>
            {mine.length === 0
              ? (lang === "th" ? "ยังไม่มีคำขอคืนสินค้า\nเข้าไปที่ BR Detail แล้วกด ขอคืนสินค้า" : "No return requests yet.\nOpen a BR detail and tap Request Return.")
              : (lang === "th" ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "No matching requests")}
          </div>
        ) : filtered.map(r => {
          const m = STATUS_META[r.status] || STATUS_META.pending;
          const total = Array.isArray(r.submittedItems) ? r.submittedItems.reduce((s, x) => s + (Number(x.totalPrice) || (Number(x.price)||0) * (Number(x.quantity)||0) || 0), 0) : 0;
          // Derive a short type summary from per-item retQty/clmQty/saleQty/freeQty.
          // Handles mixed-type items correctly (an item with retQty=2 and clmQty=1
          // contributes "RETURN" and "CLAIM" both, deduped at the request level).
          const typeSummary = Array.isArray(r.submittedItems)
            ? (() => {
                const set = new Set();
                for (const x of r.submittedItems) {
                  for (const b of breakdownFor(x)) set.add(b.key);
                }
                return [...set].join(", ");
              })()
            : "";

          let pressTimer = null;
          const startPress = () => {
            pressTimer = setTimeout(() => { setSimReq(r); pressTimer = null; }, 550);
          };
          const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

          const revCount = 1 + (Array.isArray(r.revisionHistory) ? r.revisionHistory.length : 0);
          const photoCount = Array.isArray(r.attachments) ? r.attachments.length : 0;
          const rejItemCount = Array.isArray(r.rejectedItems) ? r.rejectedItems.length : 0;
          // For approved requests with a correction history, the stored
          // r.items count is stale (it reflects only the latest revision's
          // submittedItems). Expand to the full approved-set length so
          // the row count matches what the detail view + Desktop table show.
          const rowItemCount =
            (r.status === "approved" && Array.isArray(r.revisionHistory) && r.revisionHistory.length > 0)
              ? buildApprovedFullView(r).length
              : (typeof r.items === "number" ? r.items : (Array.isArray(r.submittedItems) ? r.submittedItems.length : 0));
          return (
            <div
              key={r.id}
              onClick={() => setSelectedReq(r)}
              onMouseDown={startPress} onMouseUp={cancelPress} onMouseLeave={cancelPress}
              onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={cancelPress} onTouchCancel={cancelPress}
              style={{ background: card, border: `0.5px solid ${bdr}`, borderLeft: `3px solid ${m.color}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer", userSelect: "none" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: text }}>{r.id}</div>
                    <RevisionChip rev={revCount} lang={lang} />
                  </div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{fmtDateTime(r.date, lang)}</div>
                </div>
                <ReturnStatusPill status={r.status} size="xs" lang={lang} />
              </div>
              <div style={{ fontSize: 12, color: text, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.cust} <span style={{ color: sub }}>·</span> <span style={{ color: sub, fontFamily: "ui-monospace,monospace" }}>{r.br}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                <span style={{ color: sub }}>{rowItemCount} {lang === "th" ? "รายการ" : "items"}{typeSummary ? ` · ${typeSummary}` : ""}</span>
                <span style={{ fontWeight: 700, color: text }}>฿{total.toLocaleString()}</span>
              </div>
              {r.status === "rejected" && (
                <div style={{ marginTop: 7, padding: "7px 9px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 6, fontSize: 10, color: STATUS_META.rejected.color, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 700, marginBottom: r.adminNote ? 2 : 0 }}>
                    ⚠ {lang === "th" ? "ต้องแก้ไข" : "Needs revision"}
                    {rejItemCount > 0 ? ` · ${rejItemCount} ${lang === "th" ? "รายการ" : "item(s)"}` : ""}
                    {photoCount > 0 ? ` · ${photoCount} 📷` : ""}
                  </div>
                  {r.adminNote && (
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.adminNote}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Return detail */}
      <BottomSheet open={!!selectedReq} onClose={() => setSelectedReq(null)} height="86%" dark={dark}>
        {selectedReq && (() => {
          const m = STATUS_META[selectedReq.status] || STATUS_META.pending;
          // ── Items-in-scope filter ───────────────────────────────────
          // The detail view focuses on the items that matter for the
          // CURRENT lifecycle stage:
          //   • rejected        → only items Admin flagged this round
          //   • approved-full   → the COMPLETE post-correction set
          //                       (status === "approved" with history):
          //                       Sale needs to see all approved items
          //                       after the request is done, not just
          //                       the last-corrected subset.
          //   • corrected       → only items the Sale re-touched in the
          //                       most recent revision (still-pending
          //                       after a resubmit)
          //   • all             → the full submittedItems list as-is
          // The Rev N chip in the header + the resubmittedAt line keep
          // the "this is corrected" context visible alongside.
          const revHist = Array.isArray(selectedReq.revisionHistory) ? selectedReq.revisionHistory : [];
          let displayItems;
          let scopeMode;  // "rejected" | "approvedFull" | "corrected" | "all"
          if (selectedReq.status === "rejected") {
            // Map rejectedItems shape → submittedItems-ish shape so the
            // existing row renderer can render them uniformly. Reason is
            // carried over as _rejectReason for the inline note.
            displayItems = (selectedReq.rejectedItems || []).map(r => ({
              item_id: r.itemId || r.item_id,
              line_no: r.lineNo || r.line_no,
              product_code: r.code || r.product_code,
              product_name: r.name || r.product_name,
              price: Number(r.price) || 0,
              quantity: Number(r.quantity) || 0,
              totalPrice: Number(r.totalPrice) || ((Number(r.price)||0) * (Number(r.quantity)||0)),
              retQty:  Number(r.retQty)  || 0,
              clmQty:  Number(r.clmQty)  || 0,
              saleQty: Number(r.saleQty) || 0,
              freeQty: Number(r.freeQty) || 0,
              _rejectReason: r.reason || "",
            }));
            scopeMode = "rejected";
          } else if (selectedReq.status === "approved" && revHist.length > 0) {
            // Approved AND has a correction history: rebuild the FULL
            // approved set by overlaying every revision's items onto the
            // original submission. Sale sees the complete approved
            // request, not just the last-corrected subset.
            displayItems = buildApprovedFullView(selectedReq);
            scopeMode = "approvedFull";
          } else if (revHist.length > 0) {
            // Pending-after-correction: still under review by Admin for
            // this round. Showing only the corrected items keeps the
            // focus on what's actively being reviewed.
            const last = revHist[revHist.length - 1];
            const correctedIds = Array.isArray(last?.correctedItemIds) ? last.correctedItemIds : [];
            if (correctedIds.length > 0) {
              displayItems = (selectedReq.submittedItems || []).filter(si =>
                correctedIds.includes(si.item_id)
                || correctedIds.includes(si.itemId)
                || correctedIds.includes(`${si.product_code || si.code}-${si.line_no || si.lineNo || ""}`)
              );
              scopeMode = "corrected";
            } else {
              displayItems = selectedReq.submittedItems || [];
              scopeMode = "all";
            }
          } else {
            displayItems = selectedReq.submittedItems || [];
            scopeMode = "all";
          }
          const total = displayItems.reduce((s, x) => s + (Number(x.totalPrice) || (Number(x.price)||0) * (Number(x.quantity)||0)), 0);
          const itemsLabel = scopeMode === "rejected"
            ? (lang === "th" ? "รายการที่ต้องแก้ไข" : "Items to revise")
            : scopeMode === "approvedFull"
              ? (lang === "th" ? "รายการที่อนุมัติทั้งหมด" : "All approved items")
              : scopeMode === "corrected"
                ? (lang === "th" ? "รายการที่แก้ไขใหม่" : "Revised items")
                : (lang === "th" ? "รายการ" : "Items");
          const totalLabel = (scopeMode === "all" || scopeMode === "approvedFull")
            ? (lang === "th" ? "รวมทั้งหมด" : "Grand total")
            : (lang === "th" ? "รวมรายการที่แสดง" : "Subtotal (shown)");
          return (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div style={{ padding: "4px 20px 14px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: sub }}>{lang === "th" ? "รายละเอียดคำขอ" : "Return detail"}</div>
                  <button onClick={() => setSelectedReq(null)} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <Icon name="close" size={14} color={sub} />
                  </button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เลขที่คำขอ" : "Request ID"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{selectedReq.id}</div>
                      <RevisionChip rev={1 + (Array.isArray(selectedReq.revisionHistory) ? selectedReq.revisionHistory.length : 0)} lang={lang} />
                    </div>
                    <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>{fmtDateTime(selectedReq.date, lang)} · <b style={{ color: "#D4357A" }}>{selectedReq.sale}</b></div>
                    {selectedReq.resubmittedAt && (
                      <div style={{ fontSize: 10, color: "#D4357A", marginTop: 2 }}>
                        ↻ {lang === "th" ? "ส่งแก้ไขเมื่อ" : "Resubmitted"} {fmtDateTime(selectedReq.resubmittedAt, lang)}
                      </div>
                    )}
                  </div>
                  <ReturnStatusPill status={selectedReq.status} size="sm" lang={lang} />
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ลูกค้า / BR" : "Customer / BR"}</div>
                <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedReq.cust}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 2, fontFamily: "ui-monospace,monospace" }}>{selectedReq.custCode}</div>
                    </div>
                  </div>
                  <div style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 10, color: sub }}>BR</div>
                      <div style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", marginTop: 2 }}>{selectedReq.br}</div>
                    </div>
                  </div>
                </div>

                {/* Rejection HEADLINE banner — moved above the items list so
                    the Sale immediately sees why this request was sent back
                    before scanning rows. The per-item reasons are rendered
                    inline on each items-list row (below), so this banner
                    now carries only the overall headline + Admin remark. */}
                {selectedReq.status === "rejected" && (
                  <div style={{
                    background: STATUS_META.rejected.bg,
                    border: `0.5px solid ${STATUS_META.rejected.border}`,
                    borderRadius: 11, padding: "12px 14px", marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: selectedReq.adminNote ? 6 : 0, letterSpacing: 0.3 }}>
                      ⚠ {lang === "th" ? "มีรายการที่ต้องแก้ไข" : "Items need revision"}
                    </div>
                    {selectedReq.adminNote && (
                      <div style={{ fontSize: 12, lineHeight: 1.55, color: "#fff", whiteSpace: "pre-line" }}>
                        <b>{lang === "th" ? "หมายเหตุ Admin: " : "Admin note: "}</b>{selectedReq.adminNote}
                      </div>
                    )}
                  </div>
                )}

                {/* Items list — filtered per scopeMode (rejected ⇒ flagged
                    items only, corrected ⇒ latest revision's items only,
                    otherwise the full list). Reject reason is rendered
                    inline on each row when present. */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: scopeMode === "rejected" ? "#fff" : sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
                    {itemsLabel} ({displayItems.length})
                  </div>
                  {(scopeMode === "rejected" || scopeMode === "corrected" || scopeMode === "approvedFull") && (
                    <span style={{ fontSize: 9, color: sub, fontWeight: 600, letterSpacing: 0.3 }}>
                      {scopeMode === "rejected"
                        ? (lang === "th" ? "ซ่อนรายการที่อนุมัติแล้ว" : "Approved items hidden")
                        : scopeMode === "approvedFull"
                          ? (lang === "th" ? "รวมรายการที่ผ่านการแก้ไขด้วย" : "Includes corrected versions")
                          : (lang === "th" ? "เฉพาะรายการที่แก้ไขรอบล่าสุด" : "Latest-revision items only")}
                    </span>
                  )}
                </div>
                <div style={{ background: card, border: `0.5px solid ${scopeMode === "rejected" ? STATUS_META.rejected.border : bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
                  {displayItems.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: sub, fontSize: 12 }}>
                      {lang === "th" ? "ไม่มีรายการที่ตรงเงื่อนไข" : "No items in scope"}
                    </div>
                  ) : displayItems.map((si, i) => {
                    const breakdown = breakdownFor(si);
                    const primaryColor = breakdown.length === 1 ? breakdown[0].color : "#D4357A";
                    return (
                      <div key={i} style={{ padding: "11px 14px", borderBottom: i < displayItems.length - 1 ? `0.5px solid ${bdr}` : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: sub, fontFamily: "ui-monospace,monospace" }}>{si.product_code || si.code}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{si.product_name}</div>
                            <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{Number(si.price).toLocaleString()}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: primaryColor }}>฿{(Number(si.totalPrice) || 0).toLocaleString()}</div>
                          </div>
                        </div>
                        {/* Breakdown chip row — one chip per non-zero type */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                          {breakdown.map(b => (
                            <span key={b.key} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${b.color}55`, borderRadius: 6, padding: "2px 7px", letterSpacing: 0.3 }}>
                              {b.icon} {b.qty} {typeLabel(b, lang).toUpperCase()}
                            </span>
                          ))}
                        </div>
                        {/* Inline reject reason (rejected status only) */}
                        {si._rejectReason && (
                          <div style={{ marginTop: 8, padding: "7px 9px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 6, fontSize: 11, color: "#fff", lineHeight: 1.5 }}>
                            <b>{lang === "th" ? "เหตุผล: " : "Reason: "}</b>{si._rejectReason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedReq.remark && (
                  <>
                    <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "หมายเหตุ" : "Remark"}</div>
                    <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#ccc" : "#444", whiteSpace: "pre-line", marginBottom: 12 }}>{selectedReq.remark}</div>
                  </>
                )}

                {/* Rejected-only extras: Admin photo grid + resubmit CTA.
                    Placed after the items list so the Sale has full context
                    (banner → items + reasons → photos → action). */}
                {selectedReq.status === "rejected" && (
                  <div style={{ marginBottom: 14 }}>
                    {Array.isArray(selectedReq.attachments) && selectedReq.attachments.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: STATUS_META.rejected.color, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
                          📷 {lang === "th" ? `หลักฐานจาก Admin (${selectedReq.attachments.length})` : `Admin evidence (${selectedReq.attachments.length})`}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                          {selectedReq.attachments.map((att, i) => (
                            <button
                              key={i}
                              onClick={(e) => { e.stopPropagation(); setLightboxImages(selectedReq.attachments); setLightboxStart(i); }}
                              style={{
                                border: `0.5px solid ${bdr}`, borderRadius: 9, overflow: "hidden",
                                aspectRatio: "1 / 1", background: dark ? "#0a0a0a" : "#fafaf8",
                                padding: 0, cursor: "pointer", position: "relative",
                              }}
                            >
                              <img src={att.data} alt={att.name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              {att._demo && (
                                <span style={{ position: "absolute", top: 4, right: 4, fontSize: 8, fontWeight: 700, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "1px 5px", borderRadius: 4, letterSpacing: 0.3 }}>DEMO</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => setEditingReq(selectedReq)}
                      style={{
                        width: "100%", padding: 14, borderRadius: 12, border: "none",
                        background: "linear-gradient(135deg, #D4357A, #9A1A56)",
                        color: "#fff", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "inherit",
                        boxShadow: "0 6px 20px rgba(212,53,122,0.3)",
                        marginTop: 4,
                      }}
                    >
                      ↩ {lang === "th" ? "แก้ไขและส่งใหม่" : "Edit and resubmit"}
                    </button>
                  </div>
                )}

                {selectedReq.cancelReason && selectedReq.status === "cancelled" && (
                  <>
                    <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เหตุผลที่ยกเลิก" : "Cancel reason"}</div>
                    <div style={{ background: STATUS_META.cancelled.bg, border: `0.5px solid ${STATUS_META.cancelled.border}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#aaa" : "#444", marginBottom: 12 }}>{selectedReq.cancelReason}</div>
                  </>
                )}

                <div style={{ padding: 14, background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{totalLabel}</span>
                  <span style={{ fontSize: 17, color: "#D4357A", fontWeight: 700 }}>฿{total.toLocaleString()}</span>
                </div>

                {isTestMode() ? (
                  // In test mode, real Admin operates on Desktop — the
                  // sim button would just confuse the workflow.
                  <div style={{ marginTop: 14, padding: "10px 12px", background: dark ? "#1a1500" : "#FEFAEE", border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`, borderRadius: 9, fontSize: 11, color: dark ? "#FAC775" : "#854F0B", lineHeight: 1.55, textAlign: "center" }}>
                    🧪 {lang === "th"
                      ? "โหมดทดสอบ — ให้ Admin บน Desktop เปิด /br-return ดูคำขอนี้"
                      : "Test mode — Admin reviews this on Desktop /br-return"}
                  </div>
                ) : (
                  <button onClick={() => setSimReq(selectedReq)} style={{ marginTop: 14, width: "100%", padding: 12, borderRadius: 11, border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`, background: "transparent", color: dark ? "#FAC775" : "#854F0B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    ⚠ {lang === "th" ? "จำลองสถานะ Admin (Prototype)" : "Simulate Admin status (Prototype)"}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      {/* Date range picker sheet — opened by the calendar trigger above */}
      <DateRangePickerSheet
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        from={dateFrom}
        to={dateTo}
        dark={dark}
        lang={lang}
        onApply={(f, t) => { setDateFrom(f); setDateTo(t); }}
      />

      {/* Admin sim sheet */}
      <BottomSheet open={!!simReq} onClose={() => setSimReq(null)} height="50%" dark={dark} title={lang === "th" ? "จำลองสถานะ Admin (Prototype)" : "Simulate Admin status (Prototype)"} extraRight={<PrototypeBadge />}>
        {simReq && (
          <div style={{ padding: "12px 20px 20px", color: text, overflowY: "auto" }}>
            <div style={{ fontSize: 11, color: sub, marginBottom: 12, lineHeight: 1.55 }}>
              {lang === "th"
                ? "เครื่องมือ prototype-only — ใช้ดูว่า Sale-side UI ตอบสนองยังไงกับแต่ละสถานะ Admin"
                : "Prototype-only tool — preview how the Sale-side UI reacts to each Admin status."}
            </div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
              <span style={{ fontFamily: "ui-monospace,monospace", color: text, fontWeight: 600 }}>{simReq.id}</span>
              <span style={{ color: sub }}> · {simReq.cust}</span>
            </div>
            {["pending", "approved", "rejected", "cancelled"].map(st => {
              const sm = STATUS_META[st];
              const current = simReq.status === st;
              const isReject = st === "rejected";
              return (
                <button key={st} onClick={() => simulateStatusChange(simReq, st)} disabled={current} style={{
                  width: "100%", padding: "12px 14px", borderRadius: 11, marginBottom: 8,
                  border: `0.5px solid ${current ? sm.color : bdr}`, background: current ? sm.bg : card,
                  color: current ? sm.color : text, fontSize: 13, fontWeight: 600,
                  cursor: current ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                  opacity: current ? 1 : 0.95,
                }}>
                  <span>
                    {lang === "th" ? sm.label_th : sm.label_en}
                    {isReject && !current && <span style={{ marginLeft: 6, fontSize: 10, color: sub, fontWeight: 500 }}>({lang === "th" ? "เปิดตัวแก้คำขอ" : "opens composer"})</span>}
                  </span>
                  {current ? <span style={{ fontSize: 10, color: sm.color }}>{lang === "th" ? "ปัจจุบัน" : "current"}</span> : <Icon name="chevron" size={12} color={sub} />}
                </button>
              );
            })}
            <button onClick={() => deleteRequest(simReq)} style={{ width: "100%", padding: "12px 14px", marginTop: 8, borderRadius: 11, border: `0.5px dashed ${STATUS_META.rejected.border}`, background: "transparent", color: STATUS_META.rejected.color, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              🗑 {lang === "th" ? "ลบคำขอ (เฉพาะ prototype)" : "Delete request (prototype only)"}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Admin feedback composer — opens when "rejected" is chosen in the
          admin sim. Lets the reviewer pick which items fail, write per-item
          reasons, attach photos (real picker or demo placeholder), and a
          global admin remark. Writes back via replaceProtoReturn. */}
      <AdminFeedbackComposer
        open={!!composerReq}
        request={composerReq}
        onClose={() => setComposerReq(null)}
        onApply={(payload) => composerReq && applyAdminRejection(composerReq, payload)}
        onOpenLightbox={(imgs, start) => { setLightboxImages(imgs); setLightboxStart(start || 0); }}
        dark={dark}
        lang={lang}
      />

      {/* Edit-and-resubmit sheet — reuses RequestReturnSheet in editing
          mode. On submit, replaceProtoReturn updates the existing record
          in place and pushes a snapshot to revisionHistory. */}
      <RequestReturnSheet
        open={!!editingReq}
        onClose={() => setEditingReq(null)}
        editingRequest={editingReq}
        sale={editingReq?.sale}
        lang={lang}
        dark={dark}
        onSubmitted={(updated) => {
          refreshReturns();
          setEditingReq(null);
          // Reflect new state in the detail sheet (still open behind),
          // then surface a small toast so Sale knows the resubmit landed.
          if (updated) setSelectedReq(updated);
          setEditToast(lang === "th" ? "ส่งคำขอแก้ไขสำเร็จ" : "Resubmitted successfully");
          setTimeout(() => setEditToast(null), 2200);
        }}
      />

      {/* Fullscreen image viewer — used by both the rejection-panel photo
          grid (Sale view) and the composer's preview thumbnails (Admin). */}
      <ImageLightbox
        open={Array.isArray(lightboxImages) && lightboxImages.length > 0}
        sources={lightboxImages || []}
        startIndex={lightboxStart}
        onClose={() => setLightboxImages(null)}
      />

      {/* Lightweight success toast after a resubmit. Sits above sheets, fades
          out automatically after ~2.2s. */}
      {editToast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 90,
          transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #639922, #3A6014)",
          color: "#fff", fontSize: 13, fontWeight: 700,
          padding: "10px 18px", borderRadius: 999,
          boxShadow: "0 8px 24px rgba(99,153,34,0.4)",
          zIndex: 9998, letterSpacing: 0.3,
        }}>
          ✓ {editToast}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PROFILE SCREEN
// =============================================================================

function ProfileScreen({ dark, setDark, lang, setLang, selectedSale, onChangeSale, syncLogs, customers }) {
  const myCusts = customers.filter(c => c.sale === selectedSale);
  const bl = myCusts.filter(c => c.status === "BLOCK").length;
  const wa = myCusts.filter(c => c.status === "WARNING").length;
  const lastSync = syncLogs[0];
  const myTeam = getTeam(selectedSale);
  const bg = dark ? "#0a0a0a" : "#f5f5f3";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  return (
    <div style={{ padding: "0 16px 32px", background: bg, minHeight: "100%" }}>
      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 14, padding: "18px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 58, height: 58, borderRadius: 16, flexShrink: 0, background: "linear-gradient(135deg, #D4357A, #9A1A56)", color: "#fff", fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {selectedSale.slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: text, letterSpacing: -0.3 }}>{selectedSale}</div>
          <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>Sales Representative</div>
          <div style={{ marginTop: 5 }}><TeamPill team={myTeam} size="sm" /></div>
        </div>
      </div>

      <button onClick={onChangeSale} style={{ width: "100%", padding: "13px 16px", borderRadius: 12, border: `0.5px solid ${bdr}`, background: card, color: "#D4357A", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Icon name="refresh" size={14} color="#D4357A" />
        {lang === "th" ? "เปลี่ยน Sale" : "Change Sale"}
      </button>

      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>{lang === "th" ? "การตั้งค่า" : "Settings"}</div>
      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: `0.5px solid ${bdr}` }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: "#7F77DD22", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="moon" size={16} color="#7F77DD" /></div>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: text }}>{lang === "th" ? "โหมดมืด" : "Dark Mode"}</div>
          <div onClick={() => setDark(d => !d)} style={{ width: 44, height: 26, borderRadius: 28, background: dark ? "#D4357A" : "rgba(0,0,0,0.12)", position: "relative", cursor: "pointer" }}>
            <div style={{ position: "absolute", top: 3, left: dark ? 20 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left .22s" }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: "#378ADD22", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="globe" size={16} color="#378ADD" /></div>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: text }}>{lang === "th" ? "ภาษา" : "Language"}</div>
          <div style={{ display: "flex", background: dark ? "#2a2a2a" : "#f0f0ec", borderRadius: 8, padding: 2, gap: 2 }}>
            {["th", "en"].map(l => <button key={l} onClick={() => setLang(l)} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: lang === l ? "#D4357A" : "transparent", color: lang === l ? "#fff" : sub }}>{l.toUpperCase()}</button>)}
          </div>
        </div>
      </div>

      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: text, marginBottom: 10 }}>Sync Info</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: sub, marginBottom: 6 }}>
          <span>{lang === "th" ? "ซิงค์ล่าสุด" : "Last sync"}</span>
          <span style={{ color: text, fontWeight: 500 }}>{lastSync ? new Date(lastSync.synced_at).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: sub }}>
          <span>{lang === "th" ? "อัปเดตทุก" : "Updates every"}</span>
          <span style={{ color: "#639922", fontWeight: 600 }}>{lang === "th" ? "รายคืน (snapshot)" : "Nightly (snapshot)"}</span>
        </div>
      </div>

      <div style={{ background: dark ? "#1e1a08" : "#FEFAEE", border: `0.5px solid ${dark ? "#5a4810" : "#FAC775"}`, borderRadius: 13, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <PrototypeBadge />
          <span style={{ fontSize: 13, fontWeight: 700, color: dark ? "#FAC775" : "#854F0B" }}>Mobile Prototype</span>
        </div>
        <div style={{ fontSize: 11, color: dark ? "#FAC775" : "#854F0B", lineHeight: 1.55 }}>
          {lang === "th"
            ? "หน้าจอนี้คือ Prototype เพื่อรีวิว Mobile BR Return UX — คำขอที่ส่งจะถูกเก็บใน localStorage ของเครื่องนี้เท่านั้น ไม่ถูกส่งไปที่ Admin Desktop จริง"
            : "This screen is a prototype to review the Mobile BR Return UX. Submissions are stored locally only — they do not reach the real Admin Desktop."}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SPLASH
// =============================================================================

function SplashScreen({ visible }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: visible ? 1 : 0, transition: "opacity 0.45s ease", pointerEvents: visible ? "auto" : "none" }}>
      <div style={{ width: 88, height: 88, borderRadius: 24, background: "linear-gradient(145deg, #D4357A, #9B1D4E)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 40px rgba(212,53,122,0.45)" }}>
        <span style={{ fontSize: 44, fontWeight: 800, color: "#fff", letterSpacing: -2, lineHeight: 1 }}>N</span>
      </div>
      <div style={{ marginTop: 24 }}><PrototypeBadge /></div>
    </div>
  );
}

// =============================================================================
// SUCCESS SCREEN (full-screen confirmation after submit)
// =============================================================================
// Replaces the tab content + bottom tab bar when MobilePrototypeApp's
// `submittedRequest` state is set. Body content per user feedback — clean
// summary only: check icon, heading, description, RT card (id/date/status/
// flow text), next-step note. No item count, no total, no prototype banner.
// Bottom destination buttons live in MobilePrototypeApp main (so they sit
// in the same fixed footer where the tab bar normally would).

function SuccessScreen({ req, lang, dark }) {
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  return (
    <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 20px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 40 }}>
        <div style={{ width: 92, height: 92, borderRadius: "50%", background: "linear-gradient(135deg, #639922, #3A6014)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22, boxShadow: "0 8px 30px rgba(99,153,34,0.3)" }}>
          <svg width="46" height="46" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: text, marginBottom: 8 }}>
          {lang === "th" ? "ส่งคำขอสำเร็จ" : "Submitted Successfully"}
        </div>
        <div style={{ fontSize: 12, color: sub, textAlign: "center", maxWidth: 300, lineHeight: 1.6, marginBottom: 24 }}>
          {lang === "th"
            ? <>คำขอของคุณถูกบันทึกแล้ว Admin จะตรวจสอบและอนุมัติให้<br/>สามารถดูสถานะได้ที่แท็บ <b style={{ color: "#D4357A" }}>Returns</b></>
            : <>Your request has been saved. Admin will review and approve.<br/>Track its status under the <b style={{ color: "#D4357A" }}>Returns</b> tab.</>}
        </div>
      </div>

      <div style={{ width: "100%", padding: 16, background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>{lang === "th" ? "เลขที่คำขอ" : "Request ID"}</div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: text }}>{req.id}</div>
        <div style={{ fontSize: 11, color: sub, marginTop: 4 }}>{fmtDateTime(req.date, lang)}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <ReturnStatusPill status={req.status} size="sm" lang={lang} />
          <span style={{ fontSize: 11, color: sub }}>→ Admin {lang === "th" ? "ตรวจสอบ" : "review"} → Sheet sync</span>
        </div>
      </div>

      <div style={{ padding: "13px 14px", background: dark ? "#0a0a0a" : "#fafaf8", border: `0.5px dashed ${dark ? "#2a2a2a" : "#ddd"}`, borderRadius: 11, fontSize: 12, color: sub, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, color: dark ? "#bbb" : "#444", marginBottom: 4 }}>📌 {lang === "th" ? "ขั้นถัดไป" : "Next steps"}</div>
        {lang === "th"
          ? "Admin จะอนุมัติและระบบจะ Sync กับ Logistics File โดยอัตโนมัติ การเปลี่ยนแปลงจะปรากฏใน Dashboard ในรอบ snapshot คืนถัดไป (~23:30)"
          : "Admin will approve and the system syncs to Logistics File automatically. Changes appear on the Dashboard at the next nightly snapshot (~23:30)."}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN — MobilePrototypeApp
// =============================================================================

export default function MobilePrototypeApp() {
  const cachedData = readCache(PROTO_DATA_CACHE);
  const [tab, setTab] = useState("home");
  const [selectedSale, setSelectedSale] = useState(null);
  const [customers, setCustomers] = useState(() => Array.isArray(cachedData.customers) ? cachedData.customers : []);
  const [custValues, setCustValues] = useState(() => cachedData.custValues || {});
  const [syncLogs, setSyncLogs] = useState(() => Array.isArray(cachedData.syncLogs) ? cachedData.syncLogs : []);
  const [loading, setLoading] = useState(() => !(Array.isArray(cachedData.customers) && cachedData.customers.length > 0));
  const [refreshing, setRefreshing] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("mobile-theme") === "dark" || true);
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "th");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [splashVisible, setSplashVisible] = useState(true);

  // prototype-only state
  const [returns, setReturns] = useState(() => loadProtoReturns());
  const [returnsCount, setReturnsCount] = useState(0);
  // Full-screen success view state — when non-null, replaces the tab content
  // and bottom tab bar with a success-confirmation view + two destination
  // buttons. Driven by RequestReturnSheet.onSubmitted bubble-up.
  const [submittedRequest, setSubmittedRequest] = useState(null);
  // Toast for test-mode backend errors. Listens for the custom event
  // dispatched by postTestReturnToBackend() failure paths.
  const [testToast, setTestToast] = useState("");
  // Track whether at least one /return-requests fetch has succeeded in
  // test mode, so we know when to stop showing an empty list as "no
  // requests yet" vs "still loading".
  const [testReady, setTestReady] = useState(!isTestMode());

  const refreshReturns = useCallback(() => {
    if (isTestMode()) {
      // Backend-backed: pull fresh, then mirror into local state.
      return fetchTestReturnsFromBackend().then(arr => {
        setReturns(arr);
        setTestReady(true);
      });
    }
    setReturns(loadProtoReturns());
    return Promise.resolve();
  }, []);

  useEffect(() => { localStorage.setItem("mobile-theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { localStorage.setItem("lang", lang); }, [lang]);

  // ── One-time cleanup of legacy localStorage prototype submissions ──
  // Pre-merge, `?prototype=1` wrote RT-P-* return-requests to localStorage.
  // After the merge, the single mode is backend-connected with RT-T-* IDs,
  // so the old key is dead weight that would confuse a session that
  // mixed both eras. Clear it once per browser (sentinel-gated so we
  // don't fire the removeItem every render).
  useEffect(() => { clearLegacyPrototypeStorage(); }, []);

  // ── Test mode: initial fetch + 30s background poll + visibilitychange ──
  // The poll is paused while the document is hidden so we don't drain
  // battery on a backgrounded phone. Pull-to-refresh (refreshReturns) is
  // wired separately via the existing refresh button on the topbar.
  useEffect(() => {
    if (!isTestMode()) return undefined;
    let cancelled = false;
    let timerId = null;
    const tick = () => {
      if (document.hidden) return;
      fetchTestReturnsFromBackend().then(arr => {
        if (cancelled) return;
        setReturns(arr);
        setTestReady(true);
      });
    };
    tick(); // initial
    timerId = setInterval(tick, 30000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Surface test-mode backend errors via a small toast. The optimistic
  // local cache means the UI keeps moving even when a write fails, so
  // this is the only visible signal of a stuck POST.
  useEffect(() => {
    if (!isTestMode()) return undefined;
    const onErr = (e) => {
      // Resolve i18n key (preferred) or fall back to a literal msg
      // from older dispatch sites.
      const key = e && e.detail && e.detail.msgKey;
      const lit = e && e.detail && e.detail.msg;
      const msg = key ? _t(key, lang) : (lit || (lang === "en" ? "Backend error" : "Backend error"));
      setTestToast(msg);
      setTimeout(() => setTestToast(""), 3500);
    };
    window.addEventListener("proto-test-error", onErr);
    return () => window.removeEventListener("proto-test-error", onErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const load = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    Promise.allSettled([
      fetchJson("/customers", 2),
      fetchJson("/sync-logs", 1),
      fetchJson("/analytics/customer-value", 1),
    ]).then(results => {
      const custs = results[0].status === "fulfilled" ? results[0].value : null;
      const logs  = results[1].status === "fulfilled" ? results[1].value : null;
      const cv    = results[2].status === "fulfilled" ? results[2].value : null;
      let nextCache = readCache(PROTO_DATA_CACHE);
      if (Array.isArray(custs) && custs.length > 0) {
        const cs = custs.map(c => ({ ...c, team: getTeam(c.sale) }));
        setCustomers(cs);
        nextCache.customers = cs;
      }
      if (Array.isArray(logs))   { setSyncLogs(logs); nextCache.syncLogs = logs; }
      if (cv && !cv.error)       { setCustValues(cv); nextCache.custValues = cv; }
      writeCache(PROTO_DATA_CACHE, nextCache);
    }).finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    const minDelay = new Promise(res => setTimeout(res, 1500));
    const dataLoad = new Promise(res => { load(false); res(); });
    Promise.all([minDelay, dataLoad]).then(() => setSplashVisible(false));
  }, [load]);

  const myCusts = selectedSale ? customers.filter(c => c.sale === selectedSale) : [];

  const tabs = [
    ["home",      "home",    lang === "th" ? "หน้าหลัก" : "Home"],
    ["customers", "users",   lang === "th" ? "ลูกค้า"   : "Customers"],
    ["returns",   "returns", lang === "th" ? "คืนสินค้า" : "Returns"],
    ["alerts",    "bell",    lang === "th" ? "แจ้งเตือน" : "Alerts"],
    ["profile",   "user",    lang === "th" ? "โปรไฟล์"   : "Profile"],
  ];

  const phoneBg = dark ? "#0a0a0a" : "#f5f5f3";
  const navBg = dark ? "rgba(17,17,17,0.95)" : "rgba(255,255,255,0.95)";
  const navBdr = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const navText = dark ? "#eee" : "#111";

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: phoneBg, fontFamily: '"Inter", "IBM Plex Sans Thai", -apple-system, sans-serif', WebkitTapHighlightColor: "transparent", overscrollBehavior: "none" }}>
      {/* Spinner keyframes used by the submit button + any other inline
          loading indicators in this prototype. Inline so the file
          remains self-contained (no CSS file dependency). */}
      <style>{`@keyframes proto-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <SplashScreen visible={splashVisible} />

      {/* Test-mode backend-error toast. Sits above the topbar so it's
          impossible to miss when a /return-requests POST fails. */}
      {testToast && (
        <div style={{
          position: "fixed", left: "50%", top: 14,
          transform: "translateX(-50%)",
          background: "#3D1212", color: "#F09595",
          border: "0.5px solid #7A2020", borderRadius: 999,
          padding: "8px 16px", fontSize: 12, fontWeight: 700,
          boxShadow: "0 8px 24px rgba(226,75,74,0.3)",
          zIndex: 9999, letterSpacing: 0.3, maxWidth: "92vw",
          textAlign: "center",
        }}>⚠ {testToast}</div>
      )}

      {selectedSale && (
        <div style={{ background: navBg, backdropFilter: "blur(12px)", borderBottom: `0.5px solid ${navBdr}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {submittedRequest ? (
              // Full-screen success: title only, no back button, no PROTOTYPE badge
              <div style={{ fontSize: 16, fontWeight: 700, color: navText }}>
                {lang === "th" ? "ส่งคำขอสำเร็จ" : "Submitted Successfully"}
              </div>
            ) : (
              <>
                {tab !== "home" ? (
                  <button onClick={() => setTab("home")} style={{ width: 32, height: 32, borderRadius: 8, border: `0.5px solid ${navBdr}`, background: dark ? "#141414" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" style={{ display: "block" }}>
                      <path d="M15 6l-6 6 6 6" stroke={dark ? "#eee" : "#111"} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.5, color: navText }}>
                    <span style={{ color: "#D4357A" }}>Neo</span>Biotech
                  </div>
                )}
                {tab !== "home" && (
                  <div style={{ fontSize: 15, fontWeight: 700, color: navText }}>
                    {tab === "customers" ? (lang === "th" ? "ลูกค้า" : "Customers")
                     : tab === "returns" ? (lang === "th" ? "คืนสินค้า" : "Returns")
                     : tab === "alerts" ? (lang === "th" ? "แจ้งเตือน" : "Alerts")
                     : (lang === "th" ? "โปรไฟล์" : "Profile")}
                  </div>
                )}
                <PrototypeBadge />
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#D4357A", background: dark ? "#2D0F1A" : "#FBE8F1", border: "0.5px solid #D4357A44", borderRadius: 6, padding: "3px 8px" }}>{selectedSale}</span>
            <button onClick={() => load(true)} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${navBdr}`, background: dark ? "#141414" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: refreshing ? 0.5 : 1 }}>
              <Icon name="refresh" size={13} color={refreshing ? "#D4357A" : "#888"} />
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {!selectedSale ? (
          <SalePicker onSelect={s => { setSelectedSale(s); setTab("home"); }} dark={dark} setDark={setDark} lang={lang} setLang={setLang} />
        ) : loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: dark ? "#555" : "#aaa", fontSize: 13 }}>{lang === "th" ? "กำลังโหลดข้อมูล..." : "Loading..."}</div>
        ) : submittedRequest ? (
          // ── Full-screen success view ─────────────────────────────────
          <SuccessScreen req={submittedRequest} lang={lang} dark={dark} />
        ) : (
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {tab === "home" ? (
              <HomeScreen customers={myCusts} custValues={custValues} syncLogs={syncLogs} lang={lang} setTab={setTab} setSelectedCustomer={setSelectedCustomer} refreshing={refreshing} onRefresh={() => load(true)} dark={dark} selectedSale={selectedSale} returnsCount={returnsCount} />
            ) : tab === "customers" ? (
              <CustomersScreen customers={myCusts} custValues={custValues} lang={lang} setSelectedCustomer={setSelectedCustomer} dark={dark} />
            ) : tab === "returns" ? (
              <ReturnsScreen lang={lang} dark={dark} sale={selectedSale} returns={returns} refreshReturns={refreshReturns} setReturnsCount={setReturnsCount} />
            ) : tab === "alerts" ? (
              <AlertsScreen customers={myCusts} custValues={custValues} lang={lang} setSelectedCustomer={setSelectedCustomer} dark={dark} />
            ) : (
              <ProfileScreen dark={dark} setDark={setDark} lang={lang} setLang={setLang} selectedSale={selectedSale} onChangeSale={() => { setSelectedSale(null); setTab("home"); }} syncLogs={syncLogs} customers={customers} />
            )}
          </div>
        )}
      </div>

      {/* Bottom: success-view destinations OR normal tab bar */}
      {selectedSale && submittedRequest ? (
        <div style={{ background: navBg, backdropFilter: "blur(12px)", borderTop: `0.5px solid ${navBdr}`, padding: "12px 16px", paddingBottom: "calc(env(safe-area-inset-bottom, 8px) + 12px)", display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => {
              // "กลับไปเลือก BR" — re-open the same customer's BR list sheet so
              // the Sale can pick another BR for the same customer without
              // having to navigate back through Customers manually. Falls back
              // to the Customers tab if the customer can't be matched.
              const cust = customers.find(c => c.cust_code === submittedRequest.custCode) || null;
              setSubmittedRequest(null);
              setTab("customers");
              if (cust) setSelectedCustomer(cust);
            }}
            style={{ flex: 1, padding: 13, borderRadius: 12, border: `0.5px solid ${navBdr}`, background: "transparent", color: navText, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            {lang === "th" ? "กลับไปเลือก BR" : "Back to BR list"}
          </button>
          <button
            onClick={() => { setSubmittedRequest(null); setTab("returns"); }}
            style={{ flex: 1, padding: 13, borderRadius: 12, border: "none", background: "#D4357A", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {lang === "th" ? "ดูคำขอทั้งหมด →" : "View All Requests →"}
          </button>
        </div>
      ) : selectedSale && (
        <div style={{ background: navBg, backdropFilter: "blur(12px)", borderTop: `0.5px solid ${navBdr}`, display: "flex", flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
          {tabs.map(([key, icon, label]) => {
            const active = tab === key;
            const showBadge = key === "returns" && returnsCount > 0;
            return (
              <button key={key} onClick={() => setTab(key)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "9px 0 4px", border: "none", background: "transparent", cursor: "pointer", fontSize: 9, fontWeight: 600, color: active ? "#D4357A" : (dark ? "#fff" : "#111"), transition: "color 0.15s", position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <Icon name={icon} size={22} color={active ? "#D4357A" : (dark ? "#fff" : "#111")} />
                  {showBadge && (
                    <span style={{ position: "absolute", top: -3, right: -8, background: "#E24B4A", color: "#fff", borderRadius: 8, fontSize: 9, fontWeight: 700, padding: "0 5px", minWidth: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {returnsCount}
                    </span>
                  )}
                </div>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      <CustomerDetailSheet
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        custValues={custValues}
        lang={lang}
        dark={dark}
        sale={selectedSale}
        onProtoSubmitted={(newReq) => {
          // Close customer detail and open the full-screen success view.
          refreshReturns();
          setSelectedCustomer(null);
          setSubmittedRequest(newReq);
        }}
      />
    </div>
  );
}
