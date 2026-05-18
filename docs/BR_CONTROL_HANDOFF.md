# BR Control — Production Handoff

**Last updated:** 2026-05-15
**Period covered:** 2026-05-12 → 2026-05-15 (four days of active work, now in steady-state monitoring)
**Status:** All five planned fixes shipped + production-verified. System running autonomously overnight without human attention.
**Owner:** phumminbm (NeoBiotech Thailand)
**Repo:** https://github.com/phumminbm/borrow-control · branch `master` · Render auto-deploys

This document is written for the engineer (human or AI) picking the project up cold. It assumes no prior context about this session.

---

## TL;DR — what changed and why it matters

The session began with **every BR Return approval failing** in the Sheet-sync step ("No matching BORROW row for BR..., lineNo 29413"). Root cause was a numbering-system mismatch between the frontend and the BR Return Apps Script — the frontend was sending Summary `line_no` (a number in the 20-40K range), while the Apps Script was treating that same field as an intra-BR 1-based index (expected 1, 2, 3...).

Five commits later, the system is in a materially different operational state:

1. **`cefe05d`** — BR Return write-back now uses content matching with claimed-row tracking (no more numbering coupling)
2. **`26a4b32`** — Dashboard Outstanding Value KPI uses the backend's exact `total_value` when no filter is active (no more blank-sale silent drop)
3. **`3f7a617`** — `retrySheetSync` auto-recovers stuck `pending` cases when Apps Script confirms zero BORROW rows
4. **`8497dfa`** — Remark textarea is cleared at three independent points to prevent cross-BR bleed (final after two earlier attempts in `e7f3b3a` → `ecb54c0`)
5. The system survived a fully autonomous overnight run on **2026-05-15** with zero errors — proving the architecture is genuinely cloud-native and laptop-independent.

Production matches Sheet byte-for-byte: **16,450 BR Active · ฿180,891,268 Outstanding Value** (as of last verified run).

---

## 1. Architecture invariants (do not violate)

These are load-bearing. If you find yourself wanting to break one, stop and ask the user first.

| # | Invariant | Why it matters |
|---|---|---|
| 1 | **Logistics File is the only source of truth.** Google Sheet id `1YxnjIJWuPt4JzYQ1H7N-hdWWEZ9tRpx7A5Mea_RiRrw`, tab `Files`. | If DB and Sheet disagree, Sheet wins. Re-sync, don't mutate the DB to "fix" it. |
| 2 | **PostgreSQL DB on Render is a nightly read-side cache.** Refreshed via snapshot 23:30 → 06:00 Bangkok. | Daytime continuous sync was tried and abandoned — caused drift, duplicates, inflated Outstanding Value. |
| 3 | **NEVER run destructive content-based dedup on production rows.** | Legitimate duplicate-looking rows exist in source data (same BR, same product, same qty, same price — intentional separate line items). |
| 4 | **`POST /fix-content-duplicates` at `backend/main.py:1067` exists but MUST NOT be called.** | Would delete legitimate duplicates. User explicitly rejected this approach. Treat the endpoint as a tripwire. |
| 5 | **Match BR Return write-back rows by content + claimed-row tracking, never by index.** | The original bug. Index-based coupling between Summary and Logistics File is fragile and breaks on the slightest drift. |
| 6 | **Summary `line_no` ≠ Logistics File row number.** | Two different numbering universes. `borrow_items.line_no` is OK for Find Borrow ordering and staging dedup, but must NOT leak into write-back. |
| 7 | **Frontend → BR Return Apps Script is direct.** URL hardcoded at `backend/static/br-return.html:1387`. | Backend does not broker this webhook. Any payload-shape change requires coordinated frontend + Apps Script deploys, **frontend first**. |
| 8 | **The 80% safety check in `swap_staging_to_main` is load-bearing.** | Prevents catastrophic deletes if a sync cycle would drop more than 20% of rows. Don't bypass. |
| 9 | **Any write path to `borrows` / `borrow_items` outside `swap_staging_to_main` is suspicious.** | `/return-requests` is fine (writes to its own table). Anything else, review carefully. |
| 10 | **`POST /return-requests` is the safe metadata-edit channel for return requests.** | Pure UPSERT, no side effects, no Apps Script call. Used for manual cleanup when needed. |

---

## 2. System map

### Stack

- **Backend:** FastAPI + SQLAlchemy + Postgres on Render. Free tier (services sleep after ~15 min inactivity, but Apps Script's `deadline: 240` absorbs cold-starts).
- **Frontend (admin dashboard):** React/Vite on Render at `borrow-control-app.onrender.com`
- **BR Return UI:** static HTML at `backend/static/br-return.html`, served by FastAPI at `/br-return`
- **Find Borrow Apps Script** (Google): minute-triggered, gated to nightly window 23:30-06:00 Bangkok. Project id `1NCYdWiyngmTjJbiyD2SsHK2WDFwKn-XHm6bHhoUoRLhQZmZOK3b7rIt-`.
- **BR Return Apps Script** (Google, separate project): receives approval webhook from `br-return.html` directly. URL hardcoded in frontend.

### URLs

- Find Borrow dashboard: https://borrow-control-app.onrender.com
- BR Return UI: https://borrow-control-1.onrender.com/br-return
- Backend API (two equivalent hostnames, same Render service):
  - https://borrow-control.onrender.com (used by Find Borrow Apps Script)
  - https://borrow-control-1.onrender.com (used by BR Return UI)
- Diagnostics: `/sync-health`, `/staging-status`, `/value-debug`, `/sync-logs`, `/analytics/summary`

### Logistics File column mapping (0-based, tab `Files`)

| Field | 0-based | Col |
|---|--:|---|
| Date | 0 | A |
| Return date | 1 | B |
| STATUS | 2 | C |
| SUB-STATUS | 3 | D |
| Borrow No | 4 | E |
| Product Code | 10 | K |
| Price | 12 | M |
| Quantity | 13 | N |
| Total Price | 14 | O |

`totalCols = 15`. STATUS values: `BORROW`, `WAIT`. SUB-STATUS (when STATUS=WAIT): `RETURN`, `CLAIM`, `SALE`, `FREE`.

> The Borrow Control Summary sheet uses *different* column positions — do not assume Summary columns equal Logistics File columns. Always verify against the actual Apps Script constants before editing.

---

## 3. Commits shipped (chronological)

All commits are on `master`. Render auto-deploys on push.

### `cefe05d` — BR Return content-matching write-back (2026-05-12)

**Problem:** Every approval failing with `"No matching BORROW row for BR..., lineNo 29413"`. Root cause: frontend sent Summary `line_no` but Apps Script expected intra-BR 1-based index over its own filtered BORROW-rows-only list.

**Frontend changes** in `backend/static/br-return.html`:

| Line | Change |
|---|---|
| 1537-1540 | `productLineLabel` now returns `''` — hides misleading `#29413` chips from Step 3 list, confirm popup, detail view |
| 1843-1858 | `blankRequestItem` carries `quantity` and uses `totalPrice` (with backward-compat readers for `total` / `total_price`) |
| 1917-1922 | `fallbackSubmittedItems` emits `price` / `quantity` / `totalPrice` |
| 2918-2931 | `doSubmit` payload now includes `price: Number(p.price\|\|0)`, `quantity: Number(p.qty\|\|0)`, `totalPrice: Number(p.total\|\|0)` |

**Apps Script change** (external Google Apps Script project — user pasted manually) — replaced `findBorrowRowForItem`:

```javascript
function findBorrowRowForItem(item, code, borrowRows, usedRows) {
  var price = Number(item.price) || 0;
  var qty   = Number(item.quantity) || 0;
  var total = Number(item.totalPrice) || 0;
  for (var i = 0; i < borrowRows.length; i++) {
    var r = borrowRows[i];
    if (usedRows[r.rowNum]) continue;
    if (r.code !== code) continue;
    var rPrice = Number(r.rowData[C_PRICE]) || 0;
    var rQty   = Number(r.rowData[C_QTY])   || 0;
    var rTotal = Number(r.rowData[C_TOTAL]) || 0;
    if (rPrice === price && rQty === qty && rTotal === total) return r;
  }
  return null;
}
```

Also removed `borrowRows.push({lineNo: borrowRows.length + 1, ...})` — that field is no longer consumed. Removed the now-unreachable "Product mismatch at lineNo X" branch.

**Why this design (not the simpler "send 1-based index"):**
- Handles legitimate duplicate rows correctly via claimed-row tracking (two identical source rows both match the same content key, but `usedRows` guarantees the second item picks the second row)
- Removes any coupling between Summary and Logistics File numbering
- Aligns with the project invariant: data integrity > convenience

**Verification:** 5 acceptance tests all passed in production, including the critical "two real duplicate rows" case where the user identified actual duplicates via `COUNTIF(BR + ProductCode)`.

### `26a4b32` — Unfiltered Outstanding Value KPI fallback (2026-05-13)

**Problem:** First clean nightly cycle landed. DB and `/value-debug` showed `฿181,404,768` (matched Sheet exactly). But the admin dashboard hover read `฿181,394,268` — gap of exactly `฿10,500`. User identified 5 customers with **blank `sale` field** worth that exact amount.

**Diagnosis:** Backend was correct. `/analytics/summary.total_value` returned `181,404,768` and even included `sale_value[""] = 10500.0` for the blank-sale group. The bug was purely in `frontend/src/components/AdminView.jsx:146-148`:

```javascript
const filteredValue = analytics?.sale_value
  ? saleScope.reduce((sum, sale) => sum + (analytics.sale_value[sale] || 0), 0)
  : (analytics?.total_value || 0);
```

`saleScope` is built from the hardcoded `TEAMS` constant, which doesn't include `""` as a sale name — so blank-sale customers were silently dropped from the displayed total even though the backend included them.

**Fix:**

```javascript
const filteredValue = (saleFilter || teamFilter)
  ? saleScope.reduce((sum, sale) => sum + (analytics?.sale_value?.[sale] || 0), 0)
  : (analytics?.total_value || 0);
```

When no team/sale filter is active, use the backend's exact `total_value` directly. Filtered views unchanged (per-team / per-sale breakdowns intentionally exclude blank-sale customers).

### `3f7a617` — Smart sheetSync auto-recovery on retry (2026-05-14)

**Problem:** Two consecutive days had cases where admin approved a return, Apps Script wrote rows correctly to Logistics File, but the response never reached the browser (tab refresh / network glitch / slow Apps Script). Local `sheetSync` stayed `'pending'`. Manual SQL cleanup needed for each: RT-202605130045, RT-202605130079, plus an older RT-202605110088 missed pre-fix.

**Rate analysis:** 2 stuck-pending out of ~250 successful = 0.8% (below the user's stated 2% threshold). But the **day-over-day repetition** was psychologically alarming, so user escalated to ship now.

**Fix** in `backend/static/br-return.html` (`retrySheetSync` error callback):

```javascript
function(err){
  // Smart auto-recovery: when Apps Script reports "No BORROW rows found for BR"
  // on a retry, the Logistics File has zero BORROW rows left for this BR —
  // meaning the original approval already flipped those rows to WAIT and the
  // only thing "stuck" is local sheetSync metadata. Treat as evidence the
  // sync already completed.
  if (err && err.indexOf('No BORROW rows found for BR') !== -1) {
    r.sheetSync = 'synced';
    r.sheetSyncAt = new Date().toLocaleString('th-TH',{...});
    r.sheetSyncError = '';
    saveReturnRequest(r);
    renderAdminContent();
    showToast('ตรวจพบว่า Sheet ได้ sync ไว้แล้ว — อัปเดตสถานะเรียบร้อย ✓','success');
    return;
  }
  // otherwise — existing 'failed' behaviour preserved
  r.sheetSync = 'failed';
  r.sheetSyncError = err;
  ...
}
```

**Why safe:** Triggers only on the unambiguous `"No BORROW rows found for BR"` error (Apps Script's pre-content-match guard fires when **zero** BORROW rows exist for that BR — proof all rows are already WAIT). Does NOT trigger on:
- `"No matching BORROW row for BR..."` (content-mismatch — could be real data drift)
- Network errors
- Generic Apps Script errors

Real problems still surface as `failed`. Only the unambiguous "already done" case auto-flips.

### `e7f3b3a` → `ecb54c0` → `8497dfa` — Remark cross-BR bleed (defense in depth) (2026-05-14)

**Problem:** Sale typed remark `"คืนขาด ISAHMUA1440S = 1 ตัว"` on one BR. Same remark appeared on a subsequent NEW request for a different BR/customer. Observed on RT-202605140015 and RT-202605140016 (two different customers). Sale had to manually delete each time.

**Iterations:**

1. **`e7f3b3a`** — pre-filled remark from BR's source remark (Logistics File col P). User clarified they wanted clear-only, not pre-fill. Superseded.
2. **`ecb54c0`** — single clear in `goStep3`. User reported it still bled when "changing Sale" — suggesting either deploy lag or a path bypassing `goStep3`. Superseded.
3. **`8497dfa`** (current, final) — defense in depth: clear `ov3-remark.value` at **three independent points**.

**Final fix** in `backend/static/br-return.html`:

| Function | Line(s) | When it fires |
|---|---|---|
| `closeAll()` | 1669-1680 | Every overlay close (✕ buttons, back buttons, backdrop click, post-submit) |
| `openStep1()` | 2546-2560 | Every "สร้างคำขอคืน" (new request) click |
| `goStep3()` | 2649-2670 | Every Step 3 form open |

`editReturnRequest` (line 3132+) still loads `r.remark` AFTER calling `closeAll()`, so edit flow correctly shows the saved remark. Only `editReturnRequest` writes a non-empty value to the textarea, and only after `closeAll()` has cleared it.

**Why three points:** To leak now, a path would need to skip ALL THREE. There is no such path. Even if future code adds a new way to reach ov3, at least one of these clears catches it.

**Source-remark pre-fill (the e7f3b3a attempt) explicitly deferred** as a future feature. User only wanted to stop cross-request bleed for now.

---

## 4. Production verification timeline

| Date | Cycle | BR Active | Outstanding Value | Transient errors | Match Sheet |
|---|---|--:|--:|--:|---|
| 2026-05-12 | Pre-fix baseline | 16,682 | ฿233.2M (DB inflated) | — | ❌ |
| 2026-05-12 PM | BR Return fix tests | — | — | — | 5/5 tests passed |
| 2026-05-13 AM | First clean nightly cycle | 16,481 | ฿181,404,768 | 1 (self-healed) | ✅ byte-for-byte |
| 2026-05-14 AM | Second cycle | 16,474 | ฿181,412,068 | 4 (all self-healed) | ✅ byte-for-byte |
| 2026-05-15 AM | **First fully autonomous overnight run** (no warm tab, computer off) | **16,450** | **฿180,891,268** | **0** | ✅ byte-for-byte |

System is confirmed:
- Autonomous (no warm browser required)
- Self-healing under transient errors (retry mechanism proven across 5 incidents)
- Cold-start tolerant (240s Apps Script deadline absorbs Render free-tier wake)

---

## 5. Manual cleanup operations performed

Three return requests had stuck `sheetSync='pending'` due to the race condition (now mitigated by Fix 3 above). All cleaned via the safe `POST /return-requests` UPSERT — metadata-only, no Logistics File access, no Apps Script call, no `borrows`/`borrow_items` writes, no other return request touched.

| Date | RT ID | BR | Verification | Result |
|---|---|---|---|---|
| 2026-05-13 | RT-202605130045 | BR102604020209 | User verified Sheet showed 4 WAIT rows | sheetSync flipped to `synced` |
| 2026-05-14 | RT-202605130079 | BR102603130218 | User verified Sheet | Synced |
| 2026-05-14 | RT-202605110088 | BR102601260407 | User verified Sheet (3-day-old missed case) | Synced |

**Reusable PowerShell cleanup procedure** (UTF-8 safe — `Invoke-RestMethod` with `-UseBasicParsing` can corrupt Thai text via ISO-8859-1 default decoding):

```powershell
$url = "https://borrow-control.onrender.com/return-requests"
$wc = New-Object System.Net.WebClient
$bytes = $wc.DownloadData($url)
$rawJson = [System.Text.Encoding]::UTF8.GetString($bytes)
$all = $rawJson | ConvertFrom-Json
$target = @($all | Where-Object { $_.id -eq "RT-XXX" })[0]
$target.sheetSync = "synced"
$target.sheetSyncAt = $target.date   # reuse existing Thai date for trivial UTF-8 round-trip
$target.sheetSyncError = ""
$body = $target | ConvertTo-Json -Depth 10 -Compress
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$wcPost = New-Object System.Net.WebClient
$wcPost.Headers.Add("Content-Type", "application/json; charset=utf-8")
$resp = $wcPost.UploadData($url, "POST", $bodyBytes)
```

After Fix 3 shipped, manual cleanup should be rarely needed. If admin clicks retry on a stuck case now, the smart auto-recovery flips it to `synced` automatically.

---

## 6. Current production behavior (as of 2026-05-15)

### Healthy steady state

- `/sync-health` reports green, `hours_since_last_swap` rolls over nightly
- Staging tables empty between cycles (`/staging-status` returns 0/0/0)
- DB ↔ Sheet ↔ Dashboard hover all match byte-for-byte
- BR Return approvals write back successfully to Logistics File via content matching
- Stuck-pending status is now self-healing on retry
- Remark textarea is empty for every new request regardless of entry path
- Pre-sync sanity check guards against accidental Sheet wipes (>10% row drop aborts the cycle)
- Apps Script `LockService` prevents concurrent batch execution
- Backend returns HTTP 502 on `errors > 0` so Apps Script doesn't silently advance `lastRow`

### What happens during weekends / long holidays

User asked about this. Answer:
- Sync runs every night as scheduled, even with unchanged data
- Pre-sync sanity check passes trivially (row count unchanged)
- Swap idempotently UPSERTs every row, stamps `last_seen_at` / `updated_at` to `NOW()`
- `/sync-health` stays green because `MAX(updated_at)` refreshes
- BR count and Outstanding Value remain identical day-to-day
- **One nuance:** `days_borrowed` (Sheet column M) is `TODAY() - DATE` computed in the Sheet itself, so it ticks up daily even without human action. Some customers may flip `NORMAL → WARNING (90 days) → BLOCK (180 days)` overnight purely from aging. This is correct, intended behavior.

---

## 7. Repo navigation map

```
backend/main.py
├── DB connection pool (49-80)         — Postgres keepalives configured
├── swap_staging_to_main (236-368)     — atomic snapshot promotion, 80% safety check
├── clear_staging (370-373)            — TRUNCATE staging tables, MUST run after swap
├── /health (426)                      — lightweight liveness probe ({"status":"ok"})
├── /br-return (430)                   — serves backend/static/br-return.html
├── /customers/{cc}/brs (453-471)      — BR list with items for BR Return UI
├── /return-requests GET (496-504)     — list all return requests
├── /return-requests POST (506-561)    — UPSERT metadata (safe edit channel)
├── /sync POST (587-741)               — Apps Script batch ingestion, swap on final
├── /recalc (743-761)                  — recompute customer status (refuses if sync in progress)
├── /value-debug (763-814)             — raw outstanding value SUM, orphan-borrow detection
├── /sync-health (816-865)             — green/yellow/red staleness (28h/48h thresholds)
├── /staging-status (867-889)          — current staging row counts
├── /swap POST (891-911)               — manual swap trigger (rarely needed)
├── /analytics/summary (936-999)       — KPI source: total_value, top5, sale_ranking
├── /analytics/customer-value (1001-)  — per-customer outstanding values
├── /fix-duplicate-items (1016-1066)   — handle within-staging dups (safe)
├── /fix-content-duplicates (1067-)    — ⚠ DESTRUCTIVE — DO NOT CALL
└── /migrate (1121-)                   — schema migration endpoint

backend/static/br-return.html
├── APPS_SCRIPT_URL constant (1387)    — BR Return webhook URL (hardcoded)
├── productLineLabel (1537-1540)       — returns '' to hide #lineNo chips
├── mapBorrow (1478-1490)              — maps backend BR shape (includes remark)
├── mapItem (1542-1556)                — maps backend item (exposes price/qty/total)
├── closeAll (1669-1680)               — clears ov3-remark on every overlay close
├── blankRequestItem (1843-1858)       — request item constructor with new identity fields
├── fallbackSubmittedItems (1917-1922) — backfill constructor with identity fields
├── openStep1 (2546-2560)              — new-request entry, clears ov3-remark
├── goStep3 (2649-2670)                — opens Step 3 form, clears ov3-remark
├── doSubmit (2910-2986)               — payload to Apps Script with price/qty/totalPrice
├── editReturnRequest (3132-3170)      — edit flow, loads r.remark after closeAll
├── retrySheetSync (3421-3472)         — has smart auto-recovery on "No BORROW rows found"
└── updateSheetStatus (3783-3801)      — fetch to APPS_SCRIPT_URL

frontend/src/components/AdminView.jsx
├── saleScope construction (128-130)   — based on saleFilter / teamFilter / TEAMS
├── filteredValue (146-154)            — uses analytics.total_value when no filter
└── KPI card render (~224)             — hover shows fmtVal exact value via title attr

External: BR Return Apps Script (preserved in conversation history)
├── findBorrowRowForItem (rewritten)   — content matching + claimed-row tracking
├── handleApprove                       — LockService, partial-return split logic
├── doPost                              — entry, dispatches by data.action
└── Column constants                    — C_RTN_DATE=1, C_STATUS=2, C_SUBSTATUS=3,
                                          C_BORROW_NO=4, C_PROD_CODE=10, C_PRICE=12,
                                          C_QTY=13, C_TOTAL=14

External: Find Borrow Apps Script
├── syncBatch (every-minute trigger)   — gated to 23:30-06:00 Bangkok
├── Pre-sync sanity check               — aborts if BORROW count drops >10% vs prevNight
├── LockService.getScriptLock           — prevents concurrent batch execution
├── Backend error body check            — non-2xx OR errors > 0 → don't advance lastRow
├── line_no calculation                 — startRow + idx + 1 (1-based Summary position)
└── API_URL                             — https://borrow-control.onrender.com (no -1)
```

---

## 8. Open items (deferred, not urgent)

| Priority | Item | Notes |
|---|---|---|
| Low | **Snapshot-sheet freeze at cycle start** | Would eliminate mid-day drift abort (where a second approval same day fails until next nightly snapshot because Summary is stale). Current behavior is correct + safe. |
| Low | **Backend brokering of Apps Script call** | URL is hardcoded client-side in `br-return.html:1387`. Future security cleanup — move to server-side proxy with secret. |
| Low | **LINE / email alerting on `/sync-health` yellow** | Sketched but not built. Would be a tiny cron worker pinging `/sync-health` every 30 min, firing LINE Notify on `status != green`. User said "when ready, ask me to build it." |
| Low | **Render Starter plan upgrade** ($7/mo) | Eliminates free-tier sleep entirely. User opted not to do this — the 240s Apps Script deadline absorbs cold-start fine. |
| Low | **Render DB migration to self-hosted** | User has this planned. Will eliminate many transient errors that drive sync retries. |
| Low | **Customer data cleanup** | 5 customers in Sheet have blank `sale` and blank `customer_name` (totaling ฿10,500 in BR value). User said they'd handle this on the data side. After cleanup, per-team-sum reconciles with unfiltered total without relying on the frontend fallback. |
| Low | **Source-remark pre-fill** | Attempted in `e7f3b3a` then explicitly deferred. Would pre-fill new-request remark with the BR's own Logistics File col P remark. User said "separate feature for later." |
| Watch | **Stuck-pending recurrence rate** | Was 0.8% before Fix 3. With auto-recovery shipped, expect 0. If `failed` entries with `"No BORROW rows found"` ever appear in `sheetSyncError`, the auto-recovery isn't firing — investigate. |
| Watch | **`borrow_items.id` auto-increment growth** | Theoretical concern decades out. Each cycle re-inserts items so `id` grows ~13.5M per year. Serial caps at ~2.1B (32-bit). Plenty of headroom. |

---

## 9. Diagnostic playbook (if something breaks)

Approach pattern (from this session): **read-only diagnosis first, surgical fix second, verify third**. Never run destructive cleanups. When in doubt, use `POST /return-requests` for metadata-only changes — it's the safe channel.

### Symptom → first move

| Symptom | First diagnostic | Likely cause |
|---|---|---|
| **DB ≠ Sheet** | `curl /value-debug` and `curl /analytics/summary` | If both match Sheet → frontend display bug (like Fix 2). If neither matches → sync issue. |
| **Stuck `pending` in BR Return** | Fetch the `RT-XXX` row via `GET /return-requests` | If `submittedItems` exist + Sheet shows WAIT rows → race condition; admin clicks retry → Fix 3 auto-recovers. |
| **Failed sync / `/sync-health` yellow** | `/sync-logs` for the cycle window | Persistent Partial across many minutes = data-shaped error (one row breaks the insert). One-off Partial = Render DB transient, will self-heal. |
| **Unexpected BR count change** | Check Apps Script execution log for "Pre-sync sanity check FAILED" | Pre-sync sanity check may have aborted — IMPORTRANGE failure or accidental Sheet edit. |
| **Render cold-start timeout** | `curl -w "%{time_total}" /health` | Doesn't fail the cycle — retry mechanism absorbs. If chronic, set up external pinger or upgrade Render. |
| **Apps Script returns "Product mismatch"** | Verify the BR's source rows weren't edited after the approval was submitted | Pre-content-match guard fired — content drift. Real problem; admin should investigate. |

### Test 5 / mid-day drift signal

If admin tries to approve the same BR twice in one day, the second attempt returns `"No BORROW rows found for BR..."` — this is the **intentional safe-abort behavior** for content-matching. The Apps Script can't find any BORROW rows because the first approval already flipped them to WAIT. Don't "fix" this — the admin should wait for next nightly snapshot, OR (if the local sheetSync was already pending) the retry button will auto-recover via Fix 3.

### Useful diagnostic snippets

```powershell
# Backend health check (cold-start detector)
curl -s -w "`nTTFB: %{time_starttransfer}s`n" https://borrow-control.onrender.com/sync-health

# Pending counts across all return requests
$all = Invoke-RestMethod https://borrow-control.onrender.com/return-requests
$all | Group-Object sheetSync | Select Name, Count

# Outstanding Value sanity check (compare all three)
curl -s https://borrow-control.onrender.com/value-debug
curl -s https://borrow-control.onrender.com/analytics/summary | ConvertFrom-Json | Select total_value
```

### When NOT to act

- A single `Partial` entry in `/sync-logs` followed by a `Success` next minute — that's the documented retry mechanism, doing its job. Don't investigate. Don't "fix."
- `hours_since_last_swap` between 0 and 28 — green. Don't touch.
- BLOCK customer count rising overnight during a holiday — that's `days_borrowed` ticking up causing aging transitions. Expected.

---

## 10. Working with this user

A few things learned over the session that make collaboration smoother:

- **Technical and direct.** Reads code well, expects you to read the system before proposing changes. Won't waste time on background.
- **Signs off on every change before deploy.** Pattern: diagnose → propose with options → wait for green light → implement → commit → push → verify deploy → confirm. Don't unilaterally push code.
- **Honors stated thresholds qualitatively.** Said "ship Fix 3 if rate > 2%" but then escalated at 0.8% because of day-over-day repetition pattern. Subjective signals matter alongside numbers.
- **Doesn't want feature creep.** Multiple times during the session, proposed enhancements (source-remark pre-fill, UptimeRobot, alerting) were politely declined. Stick to the stated scope.
- **Prefers explicit, multi-option proposals.** When there are real choices (e.g. "smart retry vs manual cleanup vs reconciler endpoint"), lay them out with tradeoffs rather than picking one.
- **PowerShell is the shell.** Python is not installed natively. Use `Invoke-WebRequest` / `WebClient` for HTTP. Never `-UseBasicParsing` for UTF-8 responses (Thai text gets corrupted via ISO-8859-1 default decoding).
- **Commit messages follow this style:** Sentence-case imperative title (< 70 chars), blank line, multi-paragraph body explaining the *why*, blank line, `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer. Look at the 5 fix commits for templates.
- **Now in passive monitoring mode.** As of 2026-05-15, user will only check the morning routine (`/sync-health` green, DB ↔ Sheet match) and only re-engage if something breaks. Don't expect daily updates.

---

## 11. Recommended next moves

Only proposing where I'm confident:

1. **First contact after this handoff** — just verify steady state. `curl /sync-health` and confirm green. No code changes needed.
2. **If user reports a NEW stuck-pending case** — first check if Fix 3 fired. If user clicked retry and it stayed `failed` with `"No BORROW rows found"` in `sheetSyncError`, Fix 3 has a bug. If user just sees `pending` and never clicked retry, the fix is fine; instruct user to click retry once.
3. **If user reports DB ≠ Sheet** — always check `/value-debug` and `/analytics/summary` first. The session has TWO confirmed patterns: (a) frontend display bug while backend is correct (Fix 2 pattern), or (b) actual sync issue. The diagnostic tells you which path to take.
4. **If user requests source-remark pre-fill** — it's a small feature. The plumbing already exists (`mapBorrow` preserves `remark` at line 1488, `BRS[ST.custCode]` has full BR objects). Just pre-fill from `BRS[ST.custCode][i].remark` for matching `ST.br`, but only when textarea is empty (don't overwrite user's typing).

---

## 12. Project memory files (already populated)

The user's per-project memory at `C:\Users\USER\.claude\projects\D--\memory\` contains:

- `MEMORY.md` — index
- `project_borrow_control_overview.md` — architecture, invariants
- `project_br_return_fix.md` — full chronology of all fixes
- `feedback_data_integrity_over_dashboard.md` — the destructive-dedup principle
- `reference_borrow_control_urls.md` — all live URLs, repo, both backend hostnames
- `reference_logistics_file_columns.md` — column mapping

These persist between sessions. A fresh AI context will see them automatically via the memory system.

---

## 13. Honest gaps in this handoff

- **I have not re-verified the Apps Script source code is what we think it is.** The user pasted the original and I delivered a revised version, but I cannot directly inspect what's currently deployed in the Google Apps Script project. If `findBorrowRowForItem` behaves unexpectedly, request the current source from the user first.
- **The two Find Borrow Apps Script edge cases** discussed but not fixed:
  - Pre-sync sanity check is skipped on overnight resume after a 06:00 cutoff (intentional but can let a stale `lastRow` carry forward)
  - The empty-final-signal branch resets `lastRow` even if the POST throws — narrow edge case, would silently miss a swap
  - Neither is urgent; both are documented for future reference.
- **`borrow_items.id` round-trip:** when items get re-inserted on each swap, the `item_id` field in stored `return_requests.submittedItems` becomes stale. **Content matching makes this harmless**, but if you ever build a feature that relies on `item_id` round-tripping across nights, be aware.

---

*End of handoff. Latest production state matches Sheet byte-for-byte at 16,450 BRs / ฿180,891,268 as of the autonomous run on 2026-05-15. The system is in genuinely good shape.*
