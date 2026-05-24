// =============================================================================
// api.js — Backend API calls for Mobile BR Return
//
// All fetch calls go to the same FastAPI backend as the rest of MobileApp.
// No localStorage, no simulation. Production path only.
//
// Safety invariants:
//   • isTest defaults to false — production submissions write to the real queue
//   • The Apps Script writeback is triggered by Admin approval on Desktop, not here
//   • This file NEVER calls script.google.com or any Apps Script URL
// =============================================================================

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Load return requests for a specific Sale ─────────────────────────────────
// Fetches all non-test return_requests from the backend (limit 500, newest first)
// and filters client-side by the Sale's name — the same approach Desktop uses.
// Returns [] on any error rather than throwing, so callers can show empty state.
export async function loadReturnRequests(saleName) {
  try {
    const res = await fetch(`${API_BASE}/return-requests?limit=500&include_test=false`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`/return-requests ${res.status}`);
    const all = await res.json();
    if (!saleName) return Array.isArray(all) ? all : [];
    // Filter by sale name — case-insensitive contains match so "TANG" matches "TANG"
    return (Array.isArray(all) ? all : []).filter(r =>
      r.sale && r.sale.toUpperCase() === saleName.toUpperCase()
    );
  } catch {
    return [];
  }
}

// ── Submit (create or update) a return request ───────────────────────────────
// Calls POST /return-requests which is an UPSERT: if requestId already exists
// the row is updated (resubmit / correction path), otherwise a new row is
// created.
//
// Payload shape matches Desktop BR Return br-return.html exactly — the same
// endpoint accepts both. Key fields:
//   requestId       string   RT-YYYYMMDDHHMMSS-RR (from genReturnId())
//   custCode        string
//   custName        string
//   brNo            string
//   sale            string
//   submittedItems  array    [{itemId, code, name, qty, price, retQty, clmQty, saleQty, freeQty, remark}]
//   remark          string
//   status          string   "pending" on first submit; keep existing on resubmit
//   isTest          boolean  Always false for production. Pass true only in test mode.
//   dateSort        number   Buddhist-year BBBBMMDD (from todayDateSort())
//   attachments     array    [{name, data: dataURL}]  optional
//
// Returns { ok: true, data: {...} } or { ok: false, error: string }.
export async function submitReturnRequest(payload) {
  try {
    const res = await fetch(`${API_BASE}/return-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const e = await res.json(); msg = e.detail || e.message || msg; } catch { /* keep default */ }
      return { ok: false, error: msg };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || "Network error" };
  }
}
