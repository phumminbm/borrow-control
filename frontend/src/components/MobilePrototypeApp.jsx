// =============================================================================
// MobilePrototypeApp — Full mobile prototype with BR Return flow (Sale-side)
//
// SAFETY INVARIANTS (do not violate without explicit user approval):
//   1. This file is PROTOTYPE-ONLY. Activated via `?prototype=1` URL flag.
//   2. Reads real data from production endpoints (read-only).
//   3. Writes return requests to localStorage ONLY — NEVER to /return-requests,
//      NEVER to Logistics File, NEVER to Apps Script. Submissions are
//      physically incapable of leaking into Admin Desktop's real queue.
//   4. Uses a separate localStorage cache key from real MobileApp so the two
//      cannot pollute each other.
//   5. RT IDs use prefix "RT-P-" for visual distinction from production.
//   6. Status taxonomy matches Desktop BR Return exactly:
//      pending / approved / rejected / cancelled
//      (Thai: รอตรวจสอบคำขอ / อนุมัติแล้ว / แก้ไขคำขอ / ยกเลิกแล้ว)
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
//     2. Components: ReturnStatusPill, RequestReturnSheet, ReturnsScreen
//        (lift them verbatim from this file, drop any "Prototype" badges)
//     3. New "returns" entry in the bottom-tab `tabs` array
//     4. New "ขอคืนสินค้า" CTA button in the BR Detail header (inside
//        CustomerDetailSheet, next to the Back button)
//     5. Optional: a "Quick Action" tile on Home linking to the returns tab
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
//     - loadProtoReturns / saveProtoReturns / upsertProtoReturn
//       → replace with fetch('/return-requests') calls (GET + POST)
//     - "RT-P-" prefix in genReturnId → drop prefix to align with desktop
//     - "_prototype: true" flag on submitted requests → remove
//     - PROTOTYPE badge component + all its render sites
//     - Long-press "Simulate Admin status" handler in ReturnsScreen
//       → drop entirely (real status comes from Admin Desktop)
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

import { useState, useEffect, useMemo, useCallback } from "react";
import { TEAMS, TEAM_COLORS } from "../App";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const PROTO_DATA_CACHE  = "borrow-control:prototype-mobile-cache";
const PROTO_RETURNS_KEY = "borrow-control:prototype-mobile-returns";
const PROTO_RT_PREFIX   = "RT-P-";  // distinguishes prototype IDs from real RT-

// ── localStorage helpers ──────────────────────────────────────────────
function readCache(key)  { try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch { return {}; } }
function writeCache(key, data) { try { localStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {} }

function loadProtoReturns() {
  try {
    const raw = localStorage.getItem(PROTO_RETURNS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveProtoReturns(list) {
  try { localStorage.setItem(PROTO_RETURNS_KEY, JSON.stringify(list)); } catch {}
}
function upsertProtoReturn(req) {
  const list = loadProtoReturns();
  const idx = list.findIndex(r => r.id === req.id);
  if (idx >= 0) list[idx] = req; else list.unshift(req);
  saveProtoReturns(list);
  return list;
}

// ── ID generator: RT-P-YYYYMMDD### ────────────────────────────────────
function genProtoReturnId() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm   = String(today.getMonth() + 1).padStart(2, "0");
  const dd   = String(today.getDate()).padStart(2, "0");
  const prefix = `${PROTO_RT_PREFIX}${yyyy}${mm}${dd}`;
  const existing = loadProtoReturns()
    .map(r => r.id)
    .filter(id => typeof id === "string" && id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const seq = existing.length ? Math.max(...existing) + 1 : 1;
  return prefix + String(seq).padStart(3, "0");
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
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", year: "numeric" });
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

// Return type taxonomy (matches BR Return Apps Script)
const RETURN_TYPES = [
  { key: "RETURN", label_th: "คืน",  icon: "↩", color: "#97C459", bg: "#1A2E0A", border: "#3A6014" },
  { key: "CLAIM",  label_th: "เคลม", icon: "⚠", color: "#FAC775", bg: "#3D2A00", border: "#7A5500" },
  { key: "SALE",   label_th: "ขาย",  icon: "💰", color: "#F09595", bg: "#3D1212", border: "#7A2020" },
  { key: "FREE",   label_th: "ฟรี",  icon: "🎁", color: "#fff",    bg: "#1a1a1a", border: "#555" },
];

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

function TeamPill({ team, size = "sm" }) {
  const c = TEAM_COLORS[team] || "#888";
  return <span style={{ display: "inline-block", fontSize: size === "xs" ? 9 : 10, fontWeight: 500, color: c, background: c + "22", border: `0.5px solid ${c}44`, borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>{team}</span>;
}

function PrototypeBadge() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 9, fontWeight: 700, color: "#EF9F27",
      background: "#3D2A00", border: "0.5px solid #7A5500",
      borderRadius: 4, padding: "2px 6px", letterSpacing: 1, textTransform: "uppercase",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#EF9F27" }}/>
      Prototype
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

function RequestReturnSheet({ open, onClose, br, customer, sale, lang, dark, onSubmitted }) {
  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [perItem, setPerItem] = useState({}); // item_id -> {qty, type}
  const [remark, setRemark] = useState("");
  const [submittedReq, setSubmittedReq] = useState(null); // null = still inputting; non-null = success screen

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedIds(new Set());
      setPerItem({});
      setRemark("");
      setSubmittedReq(null);
    }
  }, [open, br?.borrow_no]);

  if (!br || !customer) {
    return <BottomSheet open={open} onClose={onClose} height="92%" dark={dark} title={lang === "th" ? "ขอคืนสินค้า" : "Request Return"} />;
  }

  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const items = Array.isArray(br.items) ? br.items : [];
  const selectedItems = items.filter(it => selectedIds.has(it.item_id));

  function togglePick(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { next.add(id); }
      return next;
    });
    setPerItem(prev => {
      if (prev[id]) return prev;
      const it = items.find(i => i.item_id === id);
      if (!it) return prev;
      return { ...prev, [id]: { qty: it.quantity, type: "RETURN" } };
    });
  }
  function setItemQty(id, qty) { setPerItem(prev => ({ ...prev, [id]: { ...(prev[id] || { type: "RETURN" }), qty } })); }
  function setItemType(id, type) { setPerItem(prev => ({ ...prev, [id]: { ...(prev[id] || { qty: 1 }), type } })); }

  const submittedItems = selectedItems.map(it => {
    const p = perItem[it.item_id] || { qty: it.quantity, type: "RETURN" };
    return {
      item_id: it.item_id,
      line_no: it.line_no,
      code: it.product_code,
      product_code: it.product_code,
      product_name: it.product_name,
      price: Number(it.price) || 0,
      quantity: Math.max(0, Math.min(it.quantity, Number(p.qty) || 0)),
      totalPrice: (Number(it.price) || 0) * Math.max(0, Math.min(it.quantity, Number(p.qty) || 0)),
      type: p.type,
      retQty:  p.type === "RETURN" ? Number(p.qty) || 0 : 0,
      clmQty:  p.type === "CLAIM"  ? Number(p.qty) || 0 : 0,
      saleQty: p.type === "SALE"   ? Number(p.qty) || 0 : 0,
      freeQty: p.type === "FREE"   ? Number(p.qty) || 0 : 0,
    };
  });
  const totalValue = submittedItems.reduce((s, x) => s + x.totalPrice, 0);
  const validStep2 = submittedItems.every(x => x.quantity > 0 && x.quantity <= (items.find(i => i.item_id === x.item_id)?.quantity || 0));

  function submit() {
    const newReq = {
      id: genProtoReturnId(),
      cust: customer.customer_name,
      custCode: customer.cust_code,
      br: br.borrow_no,
      items: submittedItems.length,
      sale,
      status: "pending",
      date: new Date().toISOString(),
      dateSort: Date.now(),
      remark: remark.trim(),
      adminNote: "",
      rejectedItems: [],
      attachments: [],
      submittedItems,
      cancelReason: "",
      sheetSync: "none",
      sheetSyncAt: "",
      sheetSyncError: "",
      _prototype: true,
    };
    upsertProtoReturn(newReq);
    setSubmittedReq(newReq);
    // Notify parent so the Returns count badge refreshes immediately, but
    // pass action=null so the parent does NOT close this sheet yet — the
    // success screen needs to stay visible until the user picks an action.
    if (onSubmitted) onSubmitted(newReq, null);
  }

  // Called from the success screen — closes the request sheet and tells the
  // parent which post-submit destination the user picked.
  function finishSubmittedFlow(action) {
    if (onSubmitted) onSubmitted(submittedReq, action);
    onClose();
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
            <div style={{ fontSize: 12, fontWeight: 600, color: sub }}>{lang === "th" ? "ขอคืนสินค้า" : "Request Return"}</div>
            <PrototypeBadge />
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="close" size={14} color={sub} />
          </button>
        </div>
        {/* BR / customer context line — hidden on the success screen so the
            confirmation summary stays clean (per user feedback). */}
        {!submittedReq && (
          <div style={{ display: "flex", gap: 6, fontSize: 11, color: sub, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "ui-monospace,monospace", color: text, fontWeight: 600 }}>{br.borrow_no}</span>·
            <span>{customer.customer_name}</span>·
            <span style={{ fontFamily: "ui-monospace,monospace" }}>{customer.cust_code}</span>
          </div>
        )}
        {/* Steps (hidden once submitted — success screen replaces the workflow) */}
        {!submittedReq && (
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
        )}
      </div>

      {/* Step body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", color: text }}>
        {submittedReq ? (
          // ── Success screen ────────────────────────────────────────────
          (() => {
            const reqTotal = (submittedReq.submittedItems || []).reduce((s, x) => s + (Number(x.totalPrice) || (Number(x.price)||0)*(Number(x.quantity)||0)), 0);
            return (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 24 }}>
                  <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #639922, #3A6014)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, boxShadow: "0 8px 30px rgba(99,153,34,0.3)" }}>
                    <svg width="40" height="40" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{lang === "th" ? "ส่งคำขอสำเร็จ" : "Submitted Successfully"}</div>
                  <div style={{ fontSize: 12, color: sub, textAlign: "center", maxWidth: 280, lineHeight: 1.55, marginBottom: 22 }}>
                    {lang === "th"
                      ? <>คำขอของคุณถูกบันทึกแล้ว Admin จะตรวจสอบและอนุมัติให้<br/>สามารถดูสถานะได้ที่แท็บ <b style={{ color: "#D4357A" }}>Returns</b></>
                      : <>Your request has been saved. Admin will review and approve.<br/>Track its status under the <b style={{ color: "#D4357A" }}>Returns</b> tab.</>}
                  </div>
                </div>

                <div style={{ width: "100%", padding: 14, background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>{lang === "th" ? "เลขที่คำขอ" : "Request ID"}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{submittedReq.id}</div>
                  <div style={{ fontSize: 11, color: sub, marginTop: 4 }}>{fmtDateTime(submittedReq.date)}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <ReturnStatusPill status={submittedReq.status} size="sm" lang={lang} />
                    <span style={{ fontSize: 11, color: sub }}>→ Admin {lang === "th" ? "ตรวจสอบ" : "review"} → Sheet sync</span>
                  </div>
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: sub }}>{submittedReq.items} {lang === "th" ? "รายการ" : "items"}</span>
                    <span style={{ fontWeight: 700, color: "#D4357A" }}>฿{reqTotal.toLocaleString()}</span>
                  </div>
                </div>

                <div style={{ padding: "12px 14px", background: dark ? "#0a0a0a" : "#fafaf8", border: `0.5px dashed ${dark ? "#2a2a2a" : "#ddd"}`, borderRadius: 11, fontSize: 11, color: sub, lineHeight: 1.55, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, color: dark ? "#aaa" : "#444", marginBottom: 4 }}>📌 {lang === "th" ? "ขั้นถัดไป" : "Next steps"}</div>
                  {lang === "th"
                    ? "Admin จะตรวจสอบและอนุมัติ ระบบจะ Sync กับ Logistics File โดยอัตโนมัติ การเปลี่ยนแปลงจะปรากฏใน Dashboard ในรอบ snapshot คืนถัดไป (~23:30)"
                    : "Admin will review and approve. The system syncs to Logistics File automatically; changes appear on the Dashboard at the next nightly snapshot (~23:30)."}
                </div>

                <div style={{ padding: "10px 12px", background: dark ? "#1e1a08" : "#FEFAEE", border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`, borderRadius: 9, fontSize: 10, color: dark ? "#FAC775" : "#854F0B", lineHeight: 1.55 }}>
                  ⚠ {lang === "th"
                    ? "Prototype: บันทึกเฉพาะใน localStorage ของเครื่องนี้ — ไม่เข้า Admin Desktop จริง"
                    : "Prototype: saved to this browser's localStorage only — does not reach real Admin Desktop"}
                </div>
              </>
            );
          })()
        ) : step === 1 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เลือกรายการที่จะคืน" : "Select items to return"}</div>
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: sub, fontSize: 12 }}>{lang === "th" ? "ไม่มีรายการในใบยืมนี้" : "No items in this BR"}</div>
            ) : items.map(it => {
              const checked = selectedIds.has(it.item_id);
              return (
                // Selected state distinguished ONLY by pink border + outer ring + filled checkbox.
                // Card background and all text colors stay identical to the unselected state so
                // the content remains clearly readable per user feedback.
                <div key={it.item_id} onClick={() => togglePick(it.item_id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", background: card, border: `1px solid ${checked ? "#D4357A" : bdr}`, borderRadius: 12, marginBottom: 8, cursor: "pointer", boxShadow: checked ? "0 0 0 1px #D4357A55" : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${checked ? "#D4357A" : "rgba(255,255,255,0.15)"}`, background: checked ? "#D4357A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {checked && <Icon name="check" size={14} color="#fff" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: sub, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{it.product_code}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, margin: "2px 0 4px", color: text }}>{it.product_name}</div>
                    <div style={{ fontSize: 10, color: sub }}>{it.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{Number(it.price).toLocaleString()} = ฿{(Number(it.price) * it.quantity).toLocaleString()}</div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ระบุจำนวนและประเภท" : "Set quantity and type"} ({submittedItems.length})</div>
            {submittedItems.map(si => {
              const original = items.find(i => i.item_id === si.item_id);
              const cfg = perItem[si.item_id] || { qty: original?.quantity || 0, type: "RETURN" };
              const typeMeta = RETURN_TYPES.find(t => t.key === cfg.type) || RETURN_TYPES[0];
              const lineTotal = (Number(original?.price) || 0) * (Number(cfg.qty) || 0);
              return (
                <div key={si.item_id} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: sub, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{original?.product_code}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{original?.product_name}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 3 }}>{lang === "th" ? "มีอยู่ทั้งหมด" : "Available"}: <span style={{ color: text, fontWeight: 600 }}>{original?.quantity} {lang === "th" ? "ชิ้น" : "pcs"}</span></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 0, background: dark ? "#1a1a1a" : "#f5f5f3", borderRadius: 8, padding: 2, border: `0.5px solid ${bdr}` }}>
                      <button onClick={() => setItemQty(si.item_id, Math.max(1, (cfg.qty || 0) - 1))} style={{ width: 28, height: 28, border: "none", background: "transparent", color: "#D4357A", fontSize: 16, fontWeight: 700, cursor: "pointer", borderRadius: 6 }}>−</button>
                      <span style={{ width: 36, textAlign: "center", fontSize: 13, fontWeight: 700 }}>{cfg.qty}</span>
                      <button onClick={() => setItemQty(si.item_id, Math.min(original?.quantity || 0, (cfg.qty || 0) + 1))} style={{ width: 28, height: 28, border: "none", background: "transparent", color: "#D4357A", fontSize: 16, fontWeight: 700, cursor: "pointer", borderRadius: 6 }}>+</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: sub, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{lang === "th" ? "ประเภท" : "Type"}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {RETURN_TYPES.map(t => {
                      const isActive = cfg.type === t.key;
                      return (
                        <button
                          key={t.key}
                          onClick={() => setItemType(si.item_id, t.key)}
                          style={{
                            flex: 1,
                            padding: "9px 4px",
                            borderRadius: 9,
                            border: `1px solid ${isActive ? t.color : t.border}`,
                            color: isActive ? t.color : (dark ? "#bbb" : "#555"),
                            background: isActive ? t.bg : "transparent",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            textAlign: "center",
                            fontFamily: "inherit",
                            boxShadow: isActive ? `0 0 0 1px ${t.color}44` : "none",
                            transition: "all 0.12s",
                          }}
                        >
                          {t.icon} {t.label_th}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, padding: "8px 11px", background: dark ? "#0a0a0a" : "#f8f8f6", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                    <span style={{ color: sub }}>{lang === "th" ? "มูลค่า" : "Value"}</span>
                    <span style={{ color: typeMeta.color, fontWeight: 700 }}>฿{lineTotal.toLocaleString()}</span>
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
                const m = RETURN_TYPES.find(t => t.key === si.type) || RETURN_TYPES[0];
                return (
                  <div key={si.item_id} style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between", borderBottom: `0.5px solid ${bdr}` }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{si.product_code}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} · <span style={{ color: m.color, fontWeight: 600 }}>{m.label_th.toUpperCase()}</span></div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: m.color }}>฿{si.totalPrice.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ตรวจสอบก่อนส่ง" : "Review before submit"}</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 10 }}>
              <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10, color: sub }}>{lang === "th" ? "ลูกค้า" : "Customer"}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{customer.customer_name}</div>
                </div>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: sub }}>{customer.cust_code}</span>
              </div>
              <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}` }}>
                <div style={{ fontSize: 10, color: sub }}>BR</div>
                <div style={{ fontSize: 13, marginTop: 2, fontFamily: "ui-monospace,monospace" }}>{br.borrow_no}</div>
              </div>
              <div style={{ padding: "11px 14px" }}>
                <div style={{ fontSize: 10, color: sub }}>Sale</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{sale}</div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "รายการ" : "Items"} ({submittedItems.length})</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 10 }}>
              {submittedItems.map(si => {
                const m = RETURN_TYPES.find(t => t.key === si.type) || RETURN_TYPES[0];
                return (
                  <div key={si.item_id} style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: sub }}>{si.product_code}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{si.product_name}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 3 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{si.price.toLocaleString()}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 9, color: m.color, fontWeight: 700, letterSpacing: 0.5 }}>{m.icon} {m.label_th.toUpperCase()}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: m.color, marginTop: 3 }}>฿{si.totalPrice.toLocaleString()}</div>
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
              ⚠ {lang === "th" ? "Prototype: คำขอนี้จะถูกเก็บเฉพาะในเครื่อง (localStorage) — ไม่ส่งไปที่ Admin จริง" : "Prototype: This request is stored in localStorage only — not sent to real Admin"}
            </div>
          </>
        )}
      </div>

      {/* Bottom action bar */}
      {submittedReq ? (
        // ── Success screen action bar — two destinations ─────────────
        <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => finishSubmittedFlow("backToList")}
            style={{ flex: 1, padding: 13, borderRadius: 12, border: `0.5px solid ${bdr}`, background: "transparent", color: text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            {lang === "th" ? "← กลับไปที่ BR List" : "← Back to BR List"}
          </button>
          <button
            onClick={() => finishSubmittedFlow("viewAll")}
            style={{ flex: 1, padding: 13, borderRadius: 12, border: "none", background: "#D4357A", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {lang === "th" ? "ดูคำขอทั้งหมด →" : "View All Requests →"}
          </button>
        </div>
      ) : (
        <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} style={{ flex: 1, padding: 12, borderRadius: 12, border: `0.5px solid ${bdr}`, background: "transparent", color: sub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
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
            <button onClick={submit} style={{ flex: 2, padding: 14, borderRadius: 12, border: "none", background: "#D4357A", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {lang === "th" ? "✓ ส่งคำขอ" : "✓ Submit"}
            </button>
          )}
        </div>
      )}
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
        onSubmitted={(newReq, action) => {
          // action = null  → first call right after save; keep the request sheet
          //                  open so the success screen can render. Just notify
          //                  the parent so the Returns badge count refreshes.
          // action = "backToList" → user picked "Back to BR List": close request
          //                  sheet + close BR detail, customer detail stays
          //                  open so the BR list reappears, do NOT switch tab.
          // action = "viewAll" → user picked "View All Requests": close
          //                  everything and switch to the Returns tab.
          if (action === null) {
            if (onProtoSubmitted) onProtoSubmitted(newReq, "refreshOnly");
            return;
          }
          setRequestOpen(false);
          setSelectedBR(null);
          if (onProtoSubmitted) onProtoSubmitted(newReq, action);
        }}
      />
    </>
  );
}

// =============================================================================
// RETURNS SCREEN (new bottom tab)
// =============================================================================

function ReturnsScreen({ lang, dark, sale, returns, refreshReturns, setReturnsCount }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [selectedReq, setSelectedReq] = useState(null);
  const [simReq, setSimReq] = useState(null); // for admin sim long-press
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

  const dateCutoff = (() => {
    if (!dateRange) return 0;
    const now = Date.now();
    if (dateRange === "today") { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
    if (dateRange === "7d")    return now - 7 * 24 * 3600 * 1000;
    if (dateRange === "30d")   return now - 30 * 24 * 3600 * 1000;
    return 0;
  })();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mine
      .filter(r =>
        (!q || (r.id || "").toLowerCase().includes(q) || (r.cust || "").toLowerCase().includes(q) || (r.br || "").toLowerCase().includes(q)) &&
        (!statusFilter || r.status === statusFilter) &&
        (!dateCutoff || (Number(r.dateSort) || 0) >= dateCutoff)
      )
      .sort((a, b) => (Number(b.dateSort) || 0) - (Number(a.dateSort) || 0));
  }, [mine, search, statusFilter, dateCutoff]);

  const hasAnyFilter = !!(search || statusFilter || dateRange);

  function simulateStatusChange(req, newStatus) {
    const updated = { ...req, status: newStatus };
    if (newStatus === "approved") { updated.sheetSync = "synced"; updated.sheetSyncAt = new Date().toISOString(); }
    if (newStatus === "rejected") { updated.adminNote = "(Simulated) please revise quantities or types."; }
    if (newStatus === "cancelled") { updated.cancelReason = "(Simulated) request cancelled."; }
    upsertProtoReturn(updated);
    refreshReturns();
    setSimReq(null);
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
          {[
            ["pending", counts.pending, STATUS_META.pending],
            ["approved", counts.approved, STATUS_META.approved],
            ["rejected", counts.rejected, STATUS_META.rejected],
            ["cancelled", counts.cancelled, STATUS_META.cancelled],
          ].map(([k, n, m]) => (
            <button key={k} onClick={() => setStatusFilter(statusFilter === k ? "" : k)} style={{ background: card, border: `0.5px solid ${statusFilter === k ? m.color : bdr}`, borderRadius: 10, padding: "9px 6px", textAlign: "center", cursor: "pointer" }}>
              <div style={{ fontSize: 9, color: m.color, fontWeight: 700, textTransform: "uppercase" }}>{m.label_short_th}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: m.color, marginTop: 3 }}>{n}</div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
          <Icon name="search" size={14} color={sub} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === "th" ? "ค้นหา RT / ลูกค้า / BR..." : "Search RT / customer / BR..."} style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "8px", fontSize: 12, color: text }} />
          {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", color: sub, cursor: "pointer", padding: 4 }}><Icon name="close" size={12} color={sub} /></button>}
        </div>

        {/* Status filter chips */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto", paddingBottom: 2 }}>
          {[["", lang === "th" ? "ทุกสถานะ" : "All"], ["pending", STATUS_META.pending.label_short_th], ["approved", STATUS_META.approved.label_short_th], ["rejected", STATUS_META.rejected.label_short_th], ["cancelled", STATUS_META.cancelled.label_short_th]].map(([v, l]) => {
            const active = statusFilter === v;
            const col = v ? STATUS_META[v]?.color : "#D4357A";
            return (
              <button key={v} onClick={() => setStatusFilter(v)} style={{ padding: "5px 11px", fontSize: 11, fontWeight: 600, borderRadius: 14, flexShrink: 0, border: `1px solid ${active ? col : "rgba(255,255,255,0.1)"}`, background: active ? col : card, color: active ? "#fff" : sub, cursor: "pointer" }}>{l}</button>
            );
          })}
        </div>

        {/* Date chips */}
        <div style={{ display: "flex", gap: 6, marginTop: 6, overflowX: "auto", paddingBottom: 2 }}>
          {[["", lang === "th" ? "ทุกวันที่" : "Any time"], ["today", lang === "th" ? "วันนี้" : "Today"], ["7d", "7d"], ["30d", "30d"]].map(([v, l]) => {
            const active = dateRange === v;
            return (
              <button key={v} onClick={() => setDateRange(v)} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, borderRadius: 12, flexShrink: 0, border: `0.5px solid ${active ? "#7F77DD" : "rgba(255,255,255,0.08)"}`, background: active ? "#7F77DD" : card, color: active ? "#fff" : sub, cursor: "pointer" }}>{l}</button>
            );
          })}
          {hasAnyFilter && (
            <button onClick={() => { setSearch(""); setStatusFilter(""); setDateRange(""); }} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, borderRadius: 12, flexShrink: 0, border: `0.5px dashed rgba(255,255,255,0.15)`, background: "transparent", color: sub, cursor: "pointer" }}>
              {lang === "th" ? "ล้างตัวกรอง ✕" : "Clear ✕"}
            </button>
          )}
        </div>

        <div style={{ fontSize: 10, color: sub, marginTop: 8 }}>{filtered.length} {lang === "th" ? "รายการ" : "results"} · {lang === "th" ? "แตะค้างเพื่อจำลองสถานะ Admin" : "Long-press to simulate Admin"}</div>
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
          const typeSummary = Array.isArray(r.submittedItems)
            ? [...new Set(r.submittedItems.map(x => x.type).filter(Boolean))].join(", ")
            : "";

          let pressTimer = null;
          const startPress = () => {
            pressTimer = setTimeout(() => { setSimReq(r); pressTimer = null; }, 550);
          };
          const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

          return (
            <div
              key={r.id}
              onClick={() => setSelectedReq(r)}
              onMouseDown={startPress} onMouseUp={cancelPress} onMouseLeave={cancelPress}
              onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={cancelPress} onTouchCancel={cancelPress}
              style={{ background: card, border: `0.5px solid ${bdr}`, borderLeft: `3px solid ${m.color}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer", userSelect: "none" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: text }}>{r.id}</div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{fmtDateTime(r.date)}</div>
                </div>
                <ReturnStatusPill status={r.status} size="xs" lang={lang} />
              </div>
              <div style={{ fontSize: 12, color: text, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.cust} <span style={{ color: sub }}>·</span> <span style={{ color: sub, fontFamily: "ui-monospace,monospace" }}>{r.br}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                <span style={{ color: sub }}>{r.items} {lang === "th" ? "รายการ" : "items"}{typeSummary ? ` · ${typeSummary}` : ""}</span>
                <span style={{ fontWeight: 700, color: text }}>฿{total.toLocaleString()}</span>
              </div>
              {r.adminNote && r.status === "rejected" && (
                <div style={{ marginTop: 7, padding: "6px 9px", background: "#2a1815", border: "0.5px solid #6b3a26", borderRadius: 6, fontSize: 10, color: "#E89C7D" }}>{lang === "th" ? "ขอแก้ไข" : "Revise"}: {r.adminNote}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Return detail */}
      <BottomSheet open={!!selectedReq} onClose={() => setSelectedReq(null)} height="86%" dark={dark}>
        {selectedReq && (() => {
          const m = STATUS_META[selectedReq.status] || STATUS_META.pending;
          const total = (selectedReq.submittedItems || []).reduce((s, x) => s + (Number(x.totalPrice) || (Number(x.price)||0) * (Number(x.quantity)||0)), 0);
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
                    <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "ui-monospace,monospace", marginTop: 2 }}>{selectedReq.id}</div>
                    <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>{fmtDateTime(selectedReq.date)} · <b style={{ color: "#D4357A" }}>{selectedReq.sale}</b></div>
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

                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "รายการ" : "Items"} ({(selectedReq.submittedItems || []).length})</div>
                <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
                  {(selectedReq.submittedItems || []).map((si, i) => {
                    const tm = RETURN_TYPES.find(t => t.key === si.type) || RETURN_TYPES[0];
                    const arr = selectedReq.submittedItems || [];
                    return (
                      <div key={i} style={{ padding: "11px 14px", borderBottom: i < arr.length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", justifyContent: "space-between" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: sub, fontFamily: "ui-monospace,monospace" }}>{si.product_code || si.code}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{si.product_name}</div>
                          <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{Number(si.price).toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 9, color: tm.color, fontWeight: 700 }}>{tm.icon} {tm.label_th.toUpperCase()}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: tm.color, marginTop: 3 }}>฿{(Number(si.totalPrice) || 0).toLocaleString()}</div>
                        </div>
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

                {selectedReq.adminNote && selectedReq.status === "rejected" && (
                  <>
                    <div style={{ fontSize: 11, color: STATUS_META.rejected.color, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ขอแก้ไขจาก Admin" : "Admin asks revision"}</div>
                    <div style={{ background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: STATUS_META.rejected.color, whiteSpace: "pre-line", marginBottom: 12 }}>{selectedReq.adminNote}</div>
                  </>
                )}

                {selectedReq.cancelReason && selectedReq.status === "cancelled" && (
                  <>
                    <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เหตุผลที่ยกเลิก" : "Cancel reason"}</div>
                    <div style={{ background: STATUS_META.cancelled.bg, border: `0.5px solid ${STATUS_META.cancelled.border}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#aaa" : "#444", marginBottom: 12 }}>{selectedReq.cancelReason}</div>
                  </>
                )}

                <div style={{ padding: 14, background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมทั้งหมด" : "Grand total"}</span>
                  <span style={{ fontSize: 17, color: "#D4357A", fontWeight: 700 }}>฿{total.toLocaleString()}</span>
                </div>

                <button onClick={() => setSimReq(selectedReq)} style={{ marginTop: 14, width: "100%", padding: 12, borderRadius: 11, border: `0.5px dashed ${dark ? "#5a4810" : "#FAC775"}`, background: "transparent", color: dark ? "#FAC775" : "#854F0B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ⚠ {lang === "th" ? "จำลองสถานะ Admin (Prototype)" : "Simulate Admin status (Prototype)"}
                </button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

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
              return (
                <button key={st} onClick={() => simulateStatusChange(simReq, st)} disabled={current} style={{
                  width: "100%", padding: "12px 14px", borderRadius: 11, marginBottom: 8,
                  border: `0.5px solid ${current ? sm.color : bdr}`, background: current ? sm.bg : card,
                  color: current ? sm.color : text, fontSize: 13, fontWeight: 600,
                  cursor: current ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                  opacity: current ? 1 : 0.95,
                }}>
                  <span>{sm.label_th}</span>
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
  const refreshReturns = useCallback(() => setReturns(loadProtoReturns()), []);

  useEffect(() => { localStorage.setItem("mobile-theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { localStorage.setItem("lang", lang); }, [lang]);

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
      <SplashScreen visible={splashVisible} />

      {selectedSale && (
        <div style={{ background: navBg, backdropFilter: "blur(12px)", borderBottom: `0.5px solid ${navBdr}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

      {selectedSale && (
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
        onProtoSubmitted={(newReq, action) => {
          refreshReturns();
          // action = "refreshOnly"  → just refresh badge counter, keep UI as-is
          //                            (the success screen is rendering inside
          //                            the request sheet — leave it open)
          // action = "backToList"   → return user to the customer's BR list;
          //                            the CustomerDetailSheet already closed
          //                            the BR detail, so the BR list shows.
          //                            Do NOT switch tab.
          // action = "viewAll"      → close customer detail and switch to
          //                            the Returns tab for the full history.
          if (action === "viewAll") {
            setSelectedCustomer(null);
            setTab("returns");
          }
        }}
      />
    </div>
  );
}
