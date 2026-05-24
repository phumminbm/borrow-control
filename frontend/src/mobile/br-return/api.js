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
// Calls POST /return-requests which is an UPSERT: if `id` already exists
// the row is updated (resubmit / correction path), otherwise a new row is
// created.
//
// Payload shape matches Desktop BR Return br-return.html:4666-4676 exactly
// and the backend Pydantic model in main.py:524-547 ReturnRequestPayload.
// Canonical field names (camelCase to match the backend model):
//   id              string   RT-YYYYMMDDHHMMSS-RR (from genReturnId())  REQUIRED
//   cust            string   Customer display name
//   custCode        string   Customer code
//   br              string   Borrow number (the BR being returned)
//   items           number   Count of submittedItems (display convenience)
//   sale            string   Sale name (uppercase, e.g. "TANG")
//   status          string   "pending" on first submit; preserved on resubmit
//   date            string   Display date string (e.g. "22 พ.ค. 2569")
//   dateSort        number   Buddhist-year BBBBMMDD (INT4-safe sort key)
//   remark          string
//   submittedItems  array    [{ itemId, lineNo, lineKey, code, name, price,
//                              quantity, totalPrice, retQty, clmQty, saleQty,
//                              freeQty }]
//   adminNote       string   "" on submit (Admin populates)
//   rejectedItems   array    [] on submit
//   attachments     array    [] on submit (Admin photos populated later)
//   cancelReason    string   ""
//   sheetSync       string   "none" initially
//   sheetSyncAt     string   ""
//   sheetSyncError  string   ""
//   isTest          boolean  Always false for production
//   revisionHistory array    [] on first submit; populated on resubmit
//   resubmittedAt   string   ISO timestamp on resubmit only
//
// Returns { ok: true, data: {...} } or { ok: false, error: stringOrObject }.
// The `error` may be a string ("HTTP 500"), the raw FastAPI 422 `detail`
// array, or another object — callers should pass it through stringifyError()
// before showing it to the user.
export async function submitReturnRequest(payload) {
  try {
    const res = await fetch(`${API_BASE}/return-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        // Preserve the raw shape (string / detail array / object) so the
        // caller's stringifier can produce a useful message for the user
        // instead of "[object Object]".
        if (body && (body.detail !== undefined || body.message !== undefined)) {
          err = body.detail !== undefined ? body.detail : body.message;
        } else if (body) {
          err = body;
        }
      } catch { /* response wasn't JSON; keep "HTTP NNN" default */ }
      return { ok: false, error: err };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err && err.message) || "Network error" };
  }
}
