// =============================================================================
// constants.js — BR Return status + type taxonomy for Mobile
//
// Matches Desktop BR Return (br-return.html) exactly.
// Also used by RequestReturnSheet, ReturnsScreen, and ReturnStatusPill.
// =============================================================================

// ── Return-request status taxonomy ──────────────────────────────────────────
// Colors are aligned to MobileApp.jsx's existing BLOCK/WARNING/NORMAL palette
// for visual continuity with the rest of the mobile UI.
//   pending   → WARNING palette (amber/orange)
//   approved  → NORMAL  palette (green)
//   rejected  → soft peach (needs revision)
//   cancelled → neutral gray
export const STATUS_META = {
  pending:   { label_th: "รอตรวจสอบคำขอ", label_short_th: "รอตรวจสอบ", label_en: "Pending review", color: "#FAC775", bg: "#3D2A00", border: "#7A5500" },
  approved:  { label_th: "อนุมัติแล้ว",  label_short_th: "อนุมัติแล้ว", label_en: "Approved",       color: "#C0DD97", bg: "#1A2E0A", border: "#3A6014" },
  rejected:  { label_th: "แก้ไขคำขอ",    label_short_th: "แก้ไขคำขอ",  label_en: "Need revision",  color: "#E89C7D", bg: "#2a1815", border: "#6b3a26" },
  cancelled: { label_th: "ยกเลิกแล้ว",   label_short_th: "ยกเลิกแล้ว", label_en: "Cancelled",      color: "#aaa",    bg: "#1a1a1a", border: "rgba(255,255,255,0.1)" },
};

// ── Return type taxonomy ─────────────────────────────────────────────────────
// Matches BR Return Apps Script types exactly. label_th + label_en both
// present so chips render in either language.
//
// NOTE on the FREE color: the prototype used "#fff" which is invisible against
// the light-mode card backgrounds in production (white-on-white). Switched to
// "#7F77DD" (purple) — distinct from RETURN green / CLAIM amber / SALE pink
// and readable on both light and dark surfaces. Matches the moon-icon purple
// already used elsewhere in MobileApp.jsx's palette.
export const RETURN_TYPES = [
  { key: "RETURN", label_th: "คืน",  label_en: "Return", icon: "↩", color: "#97C459", bg: "#1A2E0A", border: "#3A6014" },
  { key: "CLAIM",  label_th: "เคลม", label_en: "Claim",  icon: "⚠", color: "#FAC775", bg: "#3D2A00", border: "#7A5500" },
  { key: "SALE",   label_th: "ขาย",  label_en: "Sale",   icon: "💰", color: "#F09595", bg: "#3D1212", border: "#7A2020" },
  { key: "FREE",   label_th: "ฟรี",  label_en: "Free",   icon: "🎁", color: "#7F77DD", bg: "#15123D", border: "#3A337A" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

// Pick the right return-type label for the active language.
// Tolerates objects that only have label_th (legacy records) by falling through.
export function typeLabel(t, lang) {
  if (!t) return "";
  if (lang === "en") return t.label_en || t.label_th || t.key || "";
  return t.label_th || t.label_en || t.key || "";
}

// Decompose a submittedItem into the list of types it actually uses (qty > 0).
// Each entry has { key, qty, label_th, label_en, color, icon }.
// Returns [] when nothing is allocated.
// Used by Step 3/4 in RequestReturnSheet and in ReturnsScreen detail views.
export function breakdownFor(si) {
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

// Stable identity for an item across revisions. Tolerates both Desktop-canonical
// (itemId/lineNo/lineKey) and Mobile-alias (item_id/line_no) shapes.
export function itemIdentity(it) {
  return it.itemId
      || it.item_id
      || it.lineKey
      || `${it.code || it.product_code || ""}-${it.lineNo || it.line_no || ""}`;
}

// Reconstruct the COMPLETE set of approved items for a fully-approved request
// that went through one or more correction rounds. After resubmit, current
// `submittedItems` holds only the corrected items; the original items that
// Admin approved in earlier rounds live in revisionHistory[0].prevSubmittedItems.
//
// Algorithm: seed from first history entry, overlay each subsequent history
// entry, then overlay current submittedItems (latest revision).
export function buildApprovedFullView(req) {
  const hist = Array.isArray(req.revisionHistory) ? req.revisionHistory : [];
  if (hist.length === 0) return Array.isArray(req.submittedItems) ? req.submittedItems : [];
  const byId = new Map();
  const original = Array.isArray(hist[0]?.prevSubmittedItems) ? hist[0].prevSubmittedItems : [];
  for (const it of original) byId.set(itemIdentity(it), it);
  for (let i = 1; i < hist.length; i++) {
    const items = Array.isArray(hist[i]?.prevSubmittedItems) ? hist[i].prevSubmittedItems : [];
    for (const it of items) byId.set(itemIdentity(it), it);
  }
  for (const it of (Array.isArray(req.submittedItems) ? req.submittedItems : [])) {
    byId.set(itemIdentity(it), it);
  }
  return Array.from(byId.values());
}
