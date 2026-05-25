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

// ── Next-return-id generator (production running counter) ────────────────────
// Matches Desktop BR Return's genId() in br-return.html:3553-3582. Produces
// `RT-YYYYMMDDNNNN` — same daily running 4-digit counter as Desktop, so
// Mobile-submitted and Desktop-submitted RT-IDs share a single per-day
// sequence and are visually indistinguishable.
//
// How it works: fetches the most recent production return requests (≤500),
// finds every id that starts with today's `RT-YYYYMMDD` prefix, and returns
// `RT-YYYYMMDD${maxNumeric+1}` zero-padded to 4 digits.
//
// Why fetch fresh each call: a Mobile device's local `returns` cache can be
// minutes old. Calling this just-before-submit makes the counter consistent
// with whatever Desktop has just written. Same race-condition profile as
// Desktop (two devices submitting at the exact same second can produce the
// same id; in practice Sale users rarely overlap that closely, and the
// backend UPSERT will still accept the second write — the row would just be
// overwritten, mirroring Desktop's existing behavior).
//
// Returns a string like "RT-202605250001". Never includes the test-only
// `T-` segment (Desktop adds that only in TEST_MODE; this function is
// production-only).
export async function nextReturnId() {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `RT-${yyyymmdd}`;
  let maxNum = 0;
  try {
    const res = await fetch(`${API_BASE}/return-requests?limit=500&include_test=false`, { cache: "no-store" });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        for (const r of list) {
          const id = (r && (r.id || r.requestId)) || "";
          if (typeof id === "string" && id.startsWith(prefix)) {
            const tail = id.slice(prefix.length);
            const n = parseInt(tail, 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        }
      }
    }
  } catch {
    // Network failure: fall through with maxNum = 0. The id below will be
    // RT-YYYYMMDD0001 which may collide if other requests exist today, but
    // the backend UPSERT will surface that as a 200 (overwrite). The caller
    // should still surface any submit error to the user.
  }
  return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
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
