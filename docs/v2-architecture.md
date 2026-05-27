# BR Control v2 — Architecture & Handoff Document

**Last updated:** 2026-05-27
**Status:** Production. Combined v2 shell live at `/`. Supabase migration complete. BR Return embedded mode polished. Phase 5 (Mobile BR Return) complete. **Phase D complete (2026-05-27)** — a third **Dashboard** tab is live inside Desktop BR Return (Sale · Admin · **Dashboard**), computing real performance metrics client-side from the existing `RECENT` array. No new backend endpoint, no schema change. Team-based analysis was removed; the Dashboard analyzes by **Sale** only.
**Owner:** phumminbm (NeoBiotech Thailand)
**Repo:** https://github.com/phumminbm/borrow-control · branch `master` · Render auto-deploys
**Companion doc:** [`BR_CONTROL_HANDOFF.md`](BR_CONTROL_HANDOFF.md) — the older v1 handoff. Still load-bearing for write-back invariants, Logistics File schema, and the original BR Return numbering bug history. Read both.

This document is the **primary entry point** for any AI agent or developer picking the project up. It assumes you have no prior context. Read top to bottom on first encounter, then use the section headings as a reference index.

---

## 0. Read this first (60-second orientation)

- **What the system does:** Tracks customer borrows of inventory items at a Thai medical-supply distributor (NeoBiotech). The **Logistics File** (a Google Sheet) is the operational source of truth. Sales reps borrow items on behalf of customers; Admin reviews and approves returns. The Borrow Control System gives both roles a clean web UI on top of that Sheet.
- **Two modules in one shell:**
  - **Find Borrow** — read-only dashboard showing customers, overdue BRs, sync logs, KPIs. Built in React.
  - **BR Return** — write-side workflow for creating, reviewing, approving return requests. Built in vanilla JS (`backend/static/br-return.html`), embedded in the React shell via iframe.
- **Source of truth:** The Logistics File (Google Sheet). The PostgreSQL DB is a **nightly read-side cache** rebuilt by the Find Borrow Apps Script between 23:30–06:00 Bangkok. BR Return writes go back to the Sheet via a separate BR Return Apps Script.
- **Production URL:** https://borrow-control-app.onrender.com — the combined v2 shell. This is the main system as of 2026-05-19 (Phase 4 cutover).
- **Mobile parity (Phase 5, 2026-05-25):** The same Sale-side BR Return workflow is now available natively on Mobile inside `MobileApp.jsx`. Mobile and Desktop share one daily `RT-YYYYMMDDNNNN` running counter, the same backend endpoint (`POST /return-requests`), and the same Admin approval / writeback chain.

---

## 1. Production URL structure

| URL | Purpose | Status |
|---|---|---|
| **`https://borrow-control-app.onrender.com/`** | **Main system.** Combined v2 shell — Find Borrow + BR Return + topbar/sidebar | **PRODUCTION — use this** |
| `https://borrow-control-app.onrender.com/v2` | Explicit v2 alias. Same shell. Originally the Phase 2/3 parallel path, kept for bookmarks | Live; will retire later in Phase 6 |
| `https://borrow-control-app.onrender.com/?legacy=1` | Emergency rollback to the old standalone Find Borrow DesktopApp | Live as a safety net; remove in Phase 6 once stable |
| `https://borrow-control-app.onrender.com/?prototype=1` | Mobile BR Return prototype (localStorage only, no real submits) | Live; gated behind explicit flag; isolation preserved |
| `https://borrow-control-1.onrender.com/br-return` | Standalone BR Return UI (vanilla JS) — emergency direct access | Live; iframe target. Should not be used as the primary entry point |
| `https://borrow-control.onrender.com/` | Backend API hostname used by the Find Borrow Apps Script for `/sync` | Live; same Render service as `borrow-control-1` |

**Routing precedence inside `App.jsx` (top wins):**

1. `?prototype=1` → `MobilePrototypeApp`
2. `/v2` or `?v=2` → `ShellApp` (explicit, any device)
3. Mobile viewport (`<768px`) → `MobileApp`
4. `?legacy=1` (desktop) → `DesktopApp` (emergency rollback)
5. Desktop default → `ShellApp` (the new combined shell)

**Which URL is the "main" system:** `https://borrow-control-app.onrender.com/` — bare root. Everything else is an alias, escape hatch, or staging path.

---

## 2. Architecture overview

```
                                Browser
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
                  ▼                                 ▼
   borrow-control-app.onrender.com         borrow-control-1.onrender.com
   (Render Static Site, serves Vite        (Render Web Service, FastAPI)
    React build from frontend/dist/)            │
                                                │
   ShellApp.jsx                            backend/main.py
   ├── TopBar.jsx ───── theme/lang ◀──▶ (via postMessage to iframe)
   ├── Sidebar.jsx (FB / BR switch)
   ├── FBPanel.jsx ───► mounts SaleView + AdminView
   │                       (direct React, NOT iframe)
   └── BRPanel.jsx ───► <iframe src=
                          "https://borrow-control-1.onrender.com/br-return">
                            │
                            ▼
                       backend/static/br-return.html
                       (vanilla JS, embedded mode CSS via
                        :root.embedded class)
                            │
                            ├── POST /return-requests ──► backend DB
                            ├── GET  /borrow-items     ──► backend DB
                            └── POST direct to BR Return Apps Script
                                 (URL hardcoded at line 2333)
                                       │
                                       ▼
                              Logistics File (Google Sheet)
```

### Two modules, two integration patterns

**Find Borrow** lives in the React build directly. `FBPanel.jsx` mounts `<SaleView />` and `<AdminView />` from `frontend/src/modules/find-br/`. They share the same theme/lang state as the rest of the shell. Single scroll surface: `.v2-legacy-host { overflow: auto }`.

**BR Return** lives in the iframe. `BRPanel.jsx` renders `<iframe src=…/br-return>`. The iframe is **cross-origin** (different Render hostname). Communication is via `window.postMessage`. The BR Return HTML lives in the backend repo at `backend/static/br-return.html` and is served by FastAPI from `borrow-control-1.onrender.com/br-return`.

### Why iframe instead of porting BR Return to React?

The original plan (`fluttering-kindling-thompson.md`, Phase 2) explicitly chose **iframe** to preserve the working `br-return.html` byte-for-byte. The file is 5,989 lines of vanilla JS that already handles a load-bearing Apps Script webhook, localStorage state, content-matching write-back, claimed-row tracking, the correction/revision workflow, and the bilingual TH/EN dictionary. Rewriting all of that in React was rejected as too risky. The iframe approach gives a clean visual seam with zero behavioral change.

### Embedded mode (`:root.embedded`)

When `br-return.html` detects it's inside an iframe (via `window.parent !== window`), it adds `class="embedded"` to `<html>` in the very first `<script>` block (lines 9–22). All v2-shell-specific styling is gated behind `:root.embedded` selectors so **standalone access at `/br-return` is unchanged**.

Embedded mode currently:
- Hides the internal `#sidebar`, `#topbar` content, and module banner (v2-shell owns those)
- Uses v2 design tokens (`--v2-bg`, `--v2-card`, `--v2-brand`, etc.) for KPIs, filter bar, tables, modals
- **Switches the layout from internal-scroll to natural document flow** (commit `4839dd1`, 2026-05-20). The standalone layout pins `html,body{overflow:hidden}` + `#app{height:100vh}` + `#scroll-area{overflow:auto}` — a single internal scroll surface. Inside an iframe this becomes a nested-scroll trap with a barely-visible 4px scrollbar. Embedded mode neutralizes the `overflow:hidden` / `height:100vh` cascade on `html`, `body`, `#app`, `#main`, `#content`, `#scroll-area` so the iframe itself scrolls — one scroll surface, native browser scrollbar, matches Find Borrow's `.v2-legacy-host` feel.

### postMessage bridge contract

| Direction | `type` | Payload | Purpose |
|---|---|---|---|
| Shell → iframe | `theme:set` | `{ theme: 'dark' \| 'light' }` | User toggled theme in topbar |
| Shell → iframe | `lang:set`  | `{ lang:  'th'   \| 'en'    }` | User toggled lang in topbar |
| iframe → Shell | `ready`     | `{}` | Iframe finished loading — Shell replays current theme + lang |
| iframe → Shell | `badge:update` | `{ pendingCount: number }` | Updates sidebar BR badge count |

Both sides wrap their `postMessage` and `setTheme()`/`setLang()` calls in `try/catch` so a missing parent (standalone `/br-return` access) is a silent no-op. The Shell-side listener filters by both `e.origin` (must match the BR Return origin or the Shell origin) and `data.source === 'br-return'`, so cross-frame noise from extensions or other widgets is ignored.

The bridge code lives at:
- Shell side: `BRPanel.jsx` lines 80–116
- Iframe side: `br-return.html`, search for `v2ShellBridge` (around line 5927)

### Cache key strategy for iframe updates

Browsers aggressively cache cross-origin iframe documents. Render serves `br-return.html` from FastAPI with no explicit cache headers, so when we deploy a new version, the iframe can keep showing the old one for hours unless we force a reload.

**Solution:** `BRPanel.jsx` line 32–33 appends a `?v=<key>` query param to the iframe URL:

```js
const BR_RETURN_IFRAME_URL =
  BR_RETURN_URL + (BR_RETURN_URL.includes("?") ? "&" : "?") + "v=br-natural-20260520";
```

**Discipline:** Bump this key in the same commit (or right after) any time you change `br-return.html`. The new bundle hash of the React app forces the new iframe URL. Without this, the new HTML may take hours to propagate to users.

Recent cache keys (for historical reference):
- `v=br-print-20260520` — Print BR hidden-iframe fix
- `v=br-pagination-20260520` — 20-rows-per-page pagination
- `v=br-scroll-20260520` — sticky header + max-height scroll
- `v=br-page50-20260520` — 50 rows per page
- `v=br-nopin-20260520` — unpinned pagination
- `v=br-natural-20260520` — natural document flow in embedded mode
- `v=br-ok-back-20260526` — BR Return success "back to BR" action
- `v=br-dashboard-20260526` — Dashboard tab (D1, mock)
- `v=br-dashboard-fix-20260527` — Dashboard polling guard (D-fix)
- `v=br-dashboard-d3-20260527` — Dashboard live data (D3)
- `v=br-dashboard-d3-saleonly-20260527` — **current**; Dashboard Sale-only (Team removed)

---

## 3. Render services

The system runs on **three logical entry points** that are actually only **two Render services**:

### 3.1 `borrow-control-app` — Static Site

- Render product: **Static Site**
- Source: `frontend/` (built with `npm run build` → `dist/`)
- Hosts: `borrow-control-app.onrender.com`
- Serves: the React combined shell (`ShellApp` + `FBPanel` + `BRPanel`)
- Build env var: `VITE_API_URL` → points at the FastAPI service (`https://borrow-control.onrender.com`)
- Optional build env var: `VITE_BR_RETURN_URL` → defaults to `https://borrow-control-1.onrender.com/br-return`; only override for local dev

### 3.2 `borrow-control-api` — FastAPI Web Service

- Render product: **Web Service** (Python 3.12.13)
- Source: `backend/`
- Defined in `render.yaml` at repo root
- Buildcmd: `pip install -r requirements.txt`
- Startcmd: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Exposed at **two hostnames** (same service, different vanity domains):
  - **`borrow-control.onrender.com`** — used by the Find Borrow Apps Script for `POST /sync`. Do not break this hostname.
  - **`borrow-control-1.onrender.com`** — used by the BR Return iframe (`/br-return`) and BR Return UI's `fetch()` calls (`/return-requests`, `/borrow-items`, `/customers`)
- Env vars:
  - `DATABASE_URL` — Supabase Session Pooler URL on port **5432** (see Section 4)
  - `MIGRATION_MODE` — `0` in normal operation, `1` during data restores (see Section 7)
- Connects to: **Supabase Postgres** (`Borrow System` project, `br_system` schema, org: NEOBIOTECH (THAILAND) COMPANY LIMITED, Pro plan)

### 3.3 Render plan

- **Postgres:** Free tier deprecated 2026-05-09. Migrated to **Supabase Free**.
- **Web services:** Render Free for `borrow-control-api`. Service sleeps after ~15 min idle; cold-start is absorbed by the Apps Script's `deadline: 240` setting.
- **Manager has indicated Render Basic upgrade is coming** — when that happens, expect the FastAPI service to stop sleeping, and `/sync` latency improves accordingly.

### 3.4 Which service does what — quick reference

| Question | Answer |
|---|---|
| Which service serves the React shell? | `borrow-control-app` (static site) |
| Which service serves `/br-return`? | `borrow-control-api` (FastAPI), at `borrow-control-1.onrender.com/br-return` |
| Which service handles `/sync` from Apps Script? | `borrow-control-api`, at `borrow-control.onrender.com/sync` |
| Which service connects to Supabase? | Only `borrow-control-api`. The frontend never touches the DB directly. |
| Which service hosts the BR Return Apps Script? | Neither — Apps Script runs on Google. Its URL is hardcoded in `br-return.html` and called directly from the browser. |

---

## 4. Supabase setup

### Project

- **Project name:** `Borrow System`
- **Organization:** NEOBIOTECH (THAILAND) COMPANY LIMITED
- **Plan:** **Pro** (migrated from Free as part of 2026-05-19 move to company org)
- **Region:** AWS `ap-southeast-1`
- **Compute:** Nano
- **Schema:** `br_system` (everything lives under this schema, not `public`)
- **Connection used in production:** **Session Pooler, port 5432**

> **Single database for both modules.** Find Borrow and BR Return do NOT use separate databases. Both share the `Borrow System` Supabase project. All tables (`borrows`, `borrow_items`, `return_requests`, `sync_logs`) live together under `br_system`.

> **Pro plan benefits.** Project pause risk (the primary Free-tier danger) is eliminated. Disk, connection-count, and bandwidth limits are substantially higher. Monitor the Supabase usage/invoice page as the system scales — especially `sync_logs` and `return_requests` row growth, storage usage, and egress if other systems (Accounting, CRM, Inventory) are added to the same organization.

> **No `DATABASE_URL` change was needed** during the org transfer. The connection string survived the move intact. Verify this remains true for any future project migrations.

### Connection string format (Session Pooler)

```
postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Set this as `DATABASE_URL` env var on the `borrow-control-api` Render service. The backend reads it via `os.getenv("DATABASE_URL")` in `main.py`.

### ⚠️ Connection-type pitfalls (do NOT use these on Render)

| Type | Port | Why we avoid it |
|---|---:|---|
| **Direct connection** | 5432 (Supabase host) | Each FastAPI worker holds its own pool. Render Free hostname rotates IPs; Supabase Direct doesn't always permit them. Connection-count limits hit fast. |
| **Transaction Pooler** | 6543 | PgBouncer transaction mode breaks named prepared statements (SQLAlchemy uses them implicitly). Some `INSERT … RETURNING` and `ALTER TABLE` operations fail or behave unpredictably. |
| **Session Pooler** | 5432 | ✅ **Use this.** PgBouncer session mode preserves prepared statements and connection state across the request lifecycle. |

### Main tables (under schema `br_system`)

| Table | Source of data | Notes |
|---|---|---|
| `borrows` | Rebuilt nightly from Logistics File rows with `STATUS='BORROW'` | One row per active borrow (BR number) per customer. Aggregate fields: total value, days outstanding, status colors. |
| `borrow_items` | Rebuilt nightly from same Logistics File rows | Line-item detail under each BR: product code, qty, unit price, total, `line_no` (intra-BR ordering, NOT a Sheet row index — see HANDOFF doc invariant #6). **This is the single source for both Find Borrow BR Detail and Print BR.** Do not reconstruct Print BR from `return_requests`. |
| `return_requests` | Written by `br-return.html` via `POST /return-requests` | One row per return request created by Sale. Holds `submitted_items` JSON snapshot, status, revision history, photos, approval metadata, `sheet_sync` status. **Not** rebuilt by the nightly sync — survives indefinitely. |
| `sync_logs` | Written by `POST /sync` (called by Find Borrow Apps Script during nightly sync) | One row per sync run. Used by Admin → Sync Log table + `GET /sync-health`. |
| `customers` | View / computed from `borrows` | Used by Find Borrow customer list and BR Return customer picker. |
| `staging_borrows`, `staging_borrow_items` | Apps Script writes here during sync; swapped to main inside a transaction with 80% safety check | See `swap_staging_to_main` in `backend/sync_engine.py`. |

### What's rebuilt nightly vs persistent

- **Rebuilt nightly:** `borrows`, `borrow_items`, derived views, anything sourced from Logistics File rows with `STATUS='BORROW'`. Tonight's snapshot IS tomorrow's read-side cache.
- **Persistent (NOT rebuilt):** `return_requests`, `sync_logs`, photo attachments. These are the cumulative record of BR Return activity and survive every nightly cycle.

### Supabase migration status (as of 2026-05-20)

- Migration: ✅ complete
- Tables created in `br_system` schema: ✅
- `borrows` + `borrow_items` populated: ✅
- `return_requests` carried over: ✅
- **First full automated nightly sync into Supabase: TONIGHT 23:30 Bangkok.** Monitor in the morning (see Section 9).

---

## 5. Apps Script sync

Two distinct Apps Script projects. **They do not know about each other.**

### 5.1 Find Borrow Apps Script — nightly read-side sync

- **Project ID:** `1NCYdWiyngmTjJbiyD2SsHK2WDFwKn-XHm6bHhoUoRLhQZmZOK3b7rIt-`
- **Purpose:** Pulls fresh `STATUS='BORROW'` rows from the Logistics File and pushes them to the backend's `/sync` endpoint, which writes to `staging_*` tables and swaps to main at the end.
- **Trigger:** Minute-level trigger, gated to **23:30–06:00 Bangkok**. Outside that window, `syncBatch()` is a no-op.
- **Daytime sync was tried and abandoned.** It caused drift, duplicates, and inflated Outstanding Value. The nightly-only model is intentional.

#### Functions

| Function | Behavior | When to use |
|---|---|---|
| `syncBatch()` | Default trigger entrypoint. Reads sync state, processes one batch of ~500 rows, posts to `/sync`. Honors the nightly window. | **Triggered automatically.** Do not call manually. |
| `syncBatch(true)` (force) | Same as above but skips the time-window check. | Manual run in cases where the nightly window was missed. Rare. |
| `resetSync()` | Wipes the Apps Script's PropertiesService sync state (cursor, batch ID, etc.) so the next `syncBatch` starts from row 0. | Use after a structural Sheet change or when sync is stuck and you want a clean re-run. |
| `manualFullSync()` | Drives a full end-to-end sync in one synchronous call: `resetSync()` → loop `syncBatch(true)` until done → log result. | **Manual recovery only.** Use when nightly sync failed and you need to repair the DB before morning. |
| `setupTrigger()` | Idempotently sets up the minute-level time-based trigger. | After a fresh Apps Script deploy. |

#### ⚠️ Never add `manualFullSync` to a trigger

`manualFullSync` runs many `syncBatch(true)` calls back-to-back inside one Apps Script execution. As a trigger it would:
- Burst-write a large batch to `/sync` (backend may not accept concurrently with another running sync)
- Block the Apps Script execution queue for minutes
- Bypass the nightly-window gate (the whole point of the gate)

Triggers should call `syncBatch()` only. `manualFullSync` is a human-invoked recovery tool.

### 5.2 BR Return Apps Script — approval write-back

- **Separate Apps Script project.** Not in our repo (deployed by user). URL is hardcoded in `br-return.html` at line **2333**.
- **Purpose:** When Admin approves a return request, `br-return.html` POSTs directly to this Apps Script URL. The Script then updates the Logistics File rows from `BORROW` → `WAIT` (or appropriate sub-status) for the matched items.
- **Match strategy:** **Content matching with claimed-row tracking.** Each matched row is "claimed" so the same row can't be matched twice in one approval. See HANDOFF doc invariants #5–#6.
- **Frontend pays the call, backend doesn't broker it.** The backend has no `script.google.com` references. If you ever see one being added in a frontend file outside `br-return.html`, **stop and ask**.

### 5.3 Verification after nightly sync

In order:

1. **Check `/sync-health`:**
   - `https://borrow-control-1.onrender.com/sync-health`
   - Look for: `last_sync_at` within the past few hours; `swap_completed: true`; `rows_swapped` matches the Sheet's STATUS=BORROW count (currently ~16,450 BR Active).
2. **Check `/sync-logs` (last 5 runs):**
   - `https://borrow-control-1.onrender.com/sync-logs`
   - Each run should show `status: ok`, ascending `batch_id`, and reasonable `rows_inserted` counts.
3. **Check Outstanding Value on Find Borrow dashboard:**
   - Should match Sheet byte-for-byte: ฿180,891,268 (as of last verified run on 2026-05-15).
   - Drift > 1% = investigate before acting.
4. **Check BR Return Admin "stuck pending" pills:**
   - Any request that's been `pending` for >5 minutes after a recent approval is a candidate for the retry button. The smart-retry from commit `3f7a617` auto-recovers most cases.
5. **Spot-check one customer in Find Borrow → BR Detail:**
   - Pick a customer; click into a BR; verify items list matches the Sheet for that BR number.

---

## 6. Test Mode safety

BR Return ships with a **Test Mode** toggle (button in the topbar; key `isTest=true` on the request payload).

### What Test Mode does

- Generated request IDs use the prefix **`RT-T-…`** instead of `RT-…`
- Approval requests with `isTest=true` are **flagged** and processed by the BR Return Apps Script in test branch — they **do not write to the Logistics File**
- The request still lands in `return_requests` (so you can see test flow end-to-end), but its `sheet_sync` will stay `not_applicable` rather than going `synced`/`failed`
- The button styling in BR Return shows an amber badge when test mode is on

### What Test Mode MUST NOT do

- Never call the Apps Script production code path
- Never mutate `STATUS` cells in the Logistics File
- Never update real customer borrow rows
- Never count toward Sale's outstanding value totals

### Where the safety lives

- Frontend: `br-return.html` carries `isTest` through to the Apps Script POST body
- Apps Script: branches on `e.parameter.isTest === 'true'` at the entry of its `doPost`; the test branch returns a synthetic success without touching `Files` sheet
- Both branches are exercised regularly because Sale uses Test Mode during onboarding/training

### Production approval still works normally

Production approvals (no `isTest` flag) follow the normal write-back path via the BR Return Apps Script → Logistics File. Test Mode does not affect production approvals; the two paths are independent.

**If you find yourself modifying Test Mode safety, stop and ask.**

---

## 7. `MIGRATION_MODE`

Added 2026-05-19 in `backend/main.py:101` to make the Supabase data restore safe.

### What it does

When `MIGRATION_MODE=1` is set as an env var on `borrow-control-api`:

- A FastAPI middleware (`backend/main.py:119–129`) intercepts every request **before** it reaches its handler
- Endpoints in an **allow-list** are passed through normally
- All other endpoints return **HTTP 503** with `{"error": "migration_in_progress"}` + `Retry-After: 60`
- Because the request never reaches the handler, **`ensure_tables()` is never called** during the maintenance window. This was the whole point.

### Allow-list (always reachable during migration)

```
/health
/sync
/sync-health
/sync-logs
/staging-status
/br-return
/br-return.html
```

Apps Script `/sync` keeps working (so the nightly sync isn't lost). Health checks keep working (so Render doesn't kill the service). BR Return UI loads (but most of its API calls return 503 until you flip the flag).

### Why it exists — the deadlock it prevents

Without `MIGRATION_MODE`, an arriving frontend request would call `ensure_tables()` early in its handler. `ensure_tables()` issues `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` statements. During a Supabase restore, an external `pg_restore` is also holding the same tables open — the two collide, the DB deadlocks, the migration aborts halfway. Setting the env var blocks all the would-be `ensure_tables()` callers up front.

### When to use it

- Before initiating any large DB restore on `borrow-control-api`'s Postgres
- Before any operation that needs `CREATE TABLE`/`ALTER TABLE` to be the *only* DDL on the database

### How to turn it on / off

- **On:** Render dashboard → `borrow-control-api` → Environment → `MIGRATION_MODE=1` → save → trigger a deploy (or restart)
- **Off:** Set to `0` (or delete the var entirely) → save → restart

Default (env unset) = `MIGRATION_MODE=0` → middleware is fully inert → zero behavior change. Safe to leave the code in place forever.

### Side-effect that's actually a feature

While `MIGRATION_MODE=1`, BR Return Sale users see "Try again in a few minutes" toasts when they try to submit. That's intentional — you've signaled a data-maintenance window. Communicate this to the team before flipping the flag during business hours.

---

## 8. Completed work milestones

In rough chronological order, with the most recent at the bottom:

### v1 era (pre-2026-05-12)
- Initial Find Borrow dashboard, MobileApp, MobilePrototypeApp built
- Apps Script nightly sync established
- `staging_*` swap with 80% safety check
- Find Borrow BR Detail view

### Crisis week (2026-05-12 → 2026-05-15)
- BR Return write-back numbering bug fixed via **content matching + claimed-row tracking** (commit `cefe05d`)
- Outstanding Value KPI fixed to use backend's exact `total_value` when no filter is active (commit `26a4b32`)
- `retrySheetSync` auto-recovers stuck pending (commit `3f7a617`)
- Remark textarea cross-BR bleed fixed (commit `8497dfa`)
- System ran autonomously overnight on 2026-05-15 with zero errors

### v2 combined shell era (2026-05-18 → 2026-05-20)
- **Phase 0** — pre-merge tag, Backup folder created
- **Phase 1** — folder reorg: `components/` → `modules/find-br/`, `mobile/`, `modules/v2-shell/`
- **Phase 2** — built new shell at `/v2`:
  - `ShellApp.jsx`, `TopBar.jsx`, `Sidebar.jsx`, `FBPanel.jsx`, `BRPanel.jsx`, `shellTokens.css`
  - postMessage bridge contract implemented
  - `:root.embedded` styles added to `br-return.html` (the only edit to that file)
- **Phase 3** — workflow verification on `/v2` (Sale view, Admin view, submit, approve, reject, correct, retry, theme/lang persistence)
- **Phase 4** — cutover (2026-05-19): `/` now serves the new shell on desktop; `?legacy=1` kept as rollback; `/v2` kept for bookmarks; v1.2 → v2.0 in topbar
- **Supabase migration** (2026-05-19): tables, schema `br_system`, Session Pooler port 5432
- **Combined header polish** (2026-05-19): eyebrow text removed (`50d91c4`, `a0d8a1a`)
- **BR Return localization hardening** (2026-05-19): request flow + unit labels (`1127efa`, `f1566c2`)
- **BR Return Print BR fallback** + **blob print pages** (2026-05-19/20): `9bac19d`, `f88df92`
- **Print BR hidden-iframe approach** (2026-05-20): bypasses cross-origin opener severing in `/v2` mode (`b2b09b5`, merged `d5a704d`)
- **Print BR data scope unified with Find Borrow**: both use `borrow_items` table only; reconstruction from `return_requests` was rejected
- **BR Return Sale + Admin pagination — 20 rows/page** (2026-05-20): `869a90a`, merged `70596f5`
- **Pagination bumped to 50 rows/page** (2026-05-20): `3482c49`
- **Table scroll + sticky-header layout** (2026-05-20): `472199e`, merged `b424891`
- **Unpinned pagination — natural flow** (2026-05-20): `12fc258`
- **Embedded-mode natural document scroll** (2026-05-20): `4839dd1` — final layout fix matching Find Borrow's single-scroll feel
- **This documentation** (2026-05-20): `docs/v2-architecture.md` (you are here)

### Phase 5 — Mobile BR Return promotion (2026-05-23 → 2026-05-25)

**Status: COMPLETE and live on master.** Mobile now has a real production BR Return surface
(no more `?prototype=1`-only experience). Sale users can submit, track, edit, and cancel return
requests directly from their phone — Admin still reviews and approves on Desktop.

Two-branch approach delivered as planned:

| Step | Commit | Description |
|---|---|---|
| **Step 1 — extract** | `7fc9854` | Extract production BR Return module to `frontend/src/mobile/br-return/` (constants, helpers, api, components, shared, README) |
| **Step 2 — wire** | `50ba484` | Wire Returns tab into `MobileApp.jsx` as 5th tab + Request Return CTA in BR Detail (additive only, existing 4-tab structure preserved) |

Then 7 fixes shipped after live testing:

| Commit | Description |
|---|---|
| `bb10d97` | Payload field names (`id/cust/br` not `requestId/custName/brNo`), date field as locale-baked display string, FREE chip color visible in light mode |
| `511aaf0` | RT-ID running counter `RT-YYYYMMDDNNNN` (matches Desktop `genId()` byte-for-byte), locale-aware date display, full success screen with destination buttons |
| `4bab64e` | Unwrap `POST /return-requests` backend response (`{success, request}` → `request`) so the success view and "Back to BR list" handler receive the inner request object |
| `06e82e2` | Close nested BR Detail + Request Return sheets when the parent customer is dismissed (was previously stuck on top of the success screen) |
| `74af5ab` | Reserve safe-area + tab-bar space (`paddingBottom: calc(env(safe-area-inset-bottom, 8px) + 56px)`) inside both BottomSheet copies so inner CTAs are never clipped on iPhone |
| `f2a502d` | "Back to BR list" reset — clear `selectedBR` / `requestReturnOpen` in CustomerDetailSheet's customer-change useEffect so reopening the same customer always lands on the BR LIST, not on a stale BR Detail |
| `96353c8` | Sale can **edit** or **cancel** a pending request from Mobile (mirrors Desktop). Both reuse `POST /return-requests` UPSERT — no backend changes. CTAs disappear once status leaves `pending`. |

**Capabilities live on Mobile (https://borrow-control-app.onrender.com):**

- Full submit flow — pick customer → BR → 4-step form (select / allocate / remark / review) → submit
- RT-ID format `RT-YYYYMMDDNNNN` shares one daily sequence with Desktop submissions
- Date display tracks current TH/EN language (rebuilt from `dateSort` at view time, not from the locale-baked stored string)
- Full-screen success view with RT card, status pill, next-step note, and two destinations: **Back to BR list** (same customer) / **View All Requests →** (Returns tab)
- Returns tab with KPI strip, search (RT-ID / customer / BR), status filter, date range picker, detail sheet
- **Edit pending request** — Sale can change items / quantities / remark while still pending
- **Cancel pending request** — Sale provides a reason; status flips to cancelled with `cancelReason` preserved
- **Edit and resubmit** for Admin-rejected requests (existing correction flow)
- Tab-bar pink-dot badge when `pending` count > 0
- Bottom-sheet safe-area padding on every modal/sheet (no clipped CTAs)

**Cleanup performed by the user on 2026-05-25:** four test/wrong-format `return_requests` rows
that landed during live testing were removed via Supabase SQL with safety guards
(`status='pending' AND sheet_sync IN ('none','') AND is_test=FALSE`). No Logistics File impact,
no Apps Script writeback was ever triggered for those rows.

### Phase 5 polish (2026-05-25, late)

Small UI-only follow-ups after the main Phase 5 features landed:

| Commit | Description |
|---|---|
| (this commit) | **v 1.2 → v 2.0** version label across visible badges: `App.jsx:211` (DesktopApp legacy header), `MobileApp.jsx:182` (Mobile SalePicker), `MobilePrototypeApp.jsx:806` (kept the `-proto` suffix). `br-return.html` badge intentionally NOT touched per the safety rule. |
| (this commit) | **Request Return CTA icon polish** — replaced the bare `↩` Unicode emoji in the BR-Detail "ขอคืนสินค้า / Request Return" button with `<Icon name="return" size={16} color="#D4357A" />`. The emoji rendered inconsistently across iOS versions (tiny teal keycap on some, chunky pink glyph on others); the SVG renders identically everywhere and matches the bottom-tab Returns icon. |
| (this commit) | **Prevent iOS auto-zoom on input focus** — `frontend/index.html` viewport meta now includes `maximum-scale=1.0, user-scalable=no`. Stops iOS Safari from zooming the layout when the user taps any `<input>` / `<textarea>` whose font-size is below 16px (search bars, remark textareas, cancel-reason input, qty steppers). Tradeoff: page can no longer be pinch-zoomed — standard mobile-web-app pattern, acceptable for this Sale tool. |

### Phase D — BR Return Performance Dashboard (2026-05-26 → 2026-05-27)

**Status: COMPLETE and live on master.** A third tab — **Dashboard** — sits beside Sale and
Admin inside Desktop BR Return (`backend/static/br-return.html`). It is an executive performance
view computed **entirely client-side** from the `RECENT` array (the same `return_requests` data
Sale/Admin already load via `GET /return-requests?limit=5000`). **Read-only**: it never mutates
`RECENT`, never calls a write endpoint, makes no new network calls, and added **no backend
endpoint, no `/return-analytics`, no Supabase schema change, no Apps Script change.** Wrapped in
try/catch so a render error can never break Sale/Admin.

This was delivered in four sub-phases (the plan also named D2 = real-data wiring prep and a future
D-schema phase; see Section 9):

| Sub-phase | Commits | Description |
|---|---|---|
| **D1 — mock tab** | `f9ce15f`, merged `de3f918` | New Dashboard tab + full layout (10 KPI cards, 3-col chart grid, MoM, sale & recent tables) using **mock data**, bilingual via the existing `BR_STRINGS`/`_t()` dictionary. Tab wired into `switchTab()`/`setLang()`; reuses the shared `#main-content` render target and the `active-admin` chrome with a purple dot. |
| **D-fix — polling guard** | `7e1991e` | **Bug:** Dashboard flipped back to Admin after ~30s. Root cause: two async/timer callbacks (`loadReturnRequests()` poll + visibilitychange, and `applyBorrowMasterData()`) re-rendered `#main-content` with a `sale ? renderContent() : renderAdminContent()` pattern that had no `dashboard` branch. **Fix:** added `else if(ACTIVE_TAB==='dashboard') renderDashboard();` to both callbacks so every refresh path respects `ACTIVE_TAB`. |
| **D3 — live data** | `074794c`, merged `6e8ef7c` | Replaced all mock numbers with real metrics computed from `RECENT`. Added pure helper functions (see Section 10). Data-driven filters (Sale/Year/Month + Daily/Monthly mode) with live recompute. Avg-Review-time, Approved-SLA-%, and per-admin metrics **hidden** (no reliable `reviewed_at`/`approved_at`/`approved_by`); pending-aging uses `dateSort` as an explicitly-labelled approximation. Empty-state when a filter yields no rows. |
| **D3 Sale-only** | `ad7491a`, merged `042da9f` | Removed all Team features (filter, Team Performance chart, `groupByTeam`, `dashTeam`, `DASH_TEAMS` map, Team table columns, all "Unassigned" output) because the synced `sale`→team mapping is unreliable. The Team Performance chart was replaced with **Top Sale by Requests**. Dashboard now analyzes by **Sale** only. |

**Business logic — what the Dashboard reports (all from `RECENT`):**

- **QTY rule (critical):** `dashboardQty(item)` = `item.quantity` (or `.qty`); if 0/missing → `retQty+clmQty+saleQty+freeQty`. Request QTY = Σ over `submittedItems`. This counts **pieces, not item-lines** — the same rule as `requestItemQtyForPrint` (`br-return.html`).
- **Value:** `dashboardItemValue(item)` = `totalPrice` (or `total`/`total_price`); else `price × qty`.
- **Status normalization:** `normalizeStatus()` maps to `approved` / `pending` / `rejected` (= "Awaiting Revision") / `cancelled`.
- **KPIs (8 cards):** Total Requests · BR Returned (distinct `br`) · Submitted QTY · Approved QTY · Pending count+QTY · Awaiting-Revision count+QTY · Cancelled count+QTY · Total Value.
- **Charts (9):** trend (req count by day/month) · status-by-period (approved/pending/revision stacked) · Return-Type breakdown (RETURN/CLAIM/SALE/FREE by QTY+value) · Top Sale by QTY · **Top Sale by Requests** · Sheet-Sync status (synced/syncing/not-synced) · Status donut · Pending Aging (0–1 / 2–3 / 4–7 / >7 days, dateSort fallback) · Monthly Summary.
- **Tables:** Sale Performance (rank · sale · req · BR · subQty · appQty · pending · revision · cancelled · value — **no Team, no Avg-Review column**) and Recent Requests (RT-ID · date · sale · customer · BR · status · type · qty · value · sync — **no Team, no Review column**).

**Filters:** `DASH_FILTERS = { sale, year, month, mode }` — separate from Sale/Admin `FILTERS`.
Dropdown options are built from the data. Any change calls `dashSetFilter`/`dashSetMode` →
`renderDashboard()` → `applyDashboardFilters(RECENT)` → recompute. Daily/Monthly toggle re-groups
trend/status/MoM. TH/EN and light/dark preserved (CSS uses the existing `--bg2`/`--border`/`--text`/
`--pink`/`--green` theme vars; `setLang()` re-renders the active tab).

**Verification:** JS syntax clean (node `vm.Script`, 0 errors); a Node harness confirmed every
metric against sample data (QTY counts pieces not lines; unknown-sale handling; sync split);
generated HTML div-balanced (populated 238/238, empty 16/16); frontend build clean. Safety greps
confirmed no new `fetch`/`POST`/`script.google.com`/`/return-analytics` and no `main.py`/
`sync_engine.py` change across the whole Phase-D range.

---

## 9. Pending / future work

### High priority (passive — just watch)

| # | Item | When | What to do |
|---|---|---|---|
| 1 | **Watch Mobile BR Return adoption** | First 1-2 weeks after Phase 5 (2026-05-25 +) | Spot-check the Returns tab on real phones; confirm RT-ID continuity with Desktop submissions; confirm no edit/cancel race conditions cause stale "pending" rows. Use the diagnostic snippets in Section 14 if anything looks off. |
| 2 | **Verify nightly sync stays green** | Every morning | `curl /sync-health` — expect `status:"green"`, `hours_since_last_swap < 24`. |

### Medium priority (next sprint candidates)

| # | Item | Plan phase | Notes |
|---|---|---|---|
| 3 | **Mobile BR Return — Admin photo evidence rendering** | Phase 5.1 (future) | Currently rejected requests display the Admin's evidence photo grid (already wired via `selectedReq.attachments` in `ReturnsScreen.jsx:737-750`). Verify this works once a real Admin rejection with photos goes through; tune image-grid layout on phone if needed. |
| 4 | **Move `MobilePrototypeApp.jsx` to `Backup/`** | Phase 6 | Now that Mobile has the real BR Return surface, the prototype is no longer needed by Sale. Keep `?prototype=1` working long enough to verify no one relies on it (manager confirmation). Then move (not delete — user's explicit rule). |
| 5 | **Consolidate `Icon` + `BottomSheet` between `MobileApp.jsx` and `br-return/shared.jsx`** | Phase 5.2 (future) | Currently two copies of these primitives (Phase 5 Step 1 left them duplicated to keep the module self-contained). The safe-area `paddingBottom` fix has to be kept in sync between them — comment in `shared.jsx:62-66` flags this. A future cleanup can export from `MobileApp.jsx` and re-import in `shared.jsx`. |

### Lower priority (cleanup)

| # | Item | Plan phase | Notes |
|---|---|---|---|
| 5b | **Dashboard D-schema: real Avg Review / SLA / per-admin** | Phase D-schema (future) | Requires persisting `reviewed_at` / `approved_at` / `approved_by` on `return_requests` (Supabase + `POST /return-requests` + the approve path). Once present, un-hide the Avg-Review-time KPI, Approved-SLA-% KPI, the Sale-table Avg-Review column, and a per-admin workload card. Until then these stay hidden by design (the Dashboard shows a note). **Needs explicit user sign-off** — it touches the write path. |
| 5c | **Dashboard: re-introduce Team analysis** | Future | Team was removed in `ad7491a` because the synced `sale`→team mapping was unreliable. To bring it back safely, establish an authoritative sale→team source (Supabase column or a maintained map that matches real `sale` values), then restore the Team filter / Team Performance chart / Team columns. Do NOT reinstate the hardcoded `DASH_TEAMS` guess. |
| 6 | **`ensure_tables()` refactor out of per-request paths** | — | Currently called inside request handlers (which is why `MIGRATION_MODE` had to block them). Refactor to call once at app startup. Quality-of-life cleanup; not urgent because `MIGRATION_MODE` covers the failure mode. |
| 7 | **Remove `?legacy=1` gate** | Phase 6 | Wait until Phase 4 has been stable for 2 weeks (target: ~2026-06-02 met). Drop `isLegacyMode()` and `DesktopApp` import from `App.jsx`. |
| 8 | **Retire `/v2` alias** | Phase 6 | Wait until manager confirms no one is using the alias. Drop `isV2Mode()`. |
| 9 | **Update `BR_CONTROL_HANDOFF.md` system map** | Phase 6 | Add a "see also: v2-architecture.md" pointer to the v1 doc. The v1 doc's invariants are still load-bearing for write-back. |
| 10 | **Keep this doc current** | Ongoing | See Section 12 — handoff discipline. |

---

## 10. Important files

### Frontend — root + routing

| Path | Role |
|---|---|
| `frontend/src/App.jsx` | **Root router.** Defines route precedence (`?prototype=1`, `/v2`, mobile viewport, `?legacy=1`, default). Hosts the old `DesktopApp`. Exports `T` (TH/EN dictionary), `TEAMS`, `TEAM_COLORS`, `SC` (status colors), `StatusBadge`. |
| `frontend/src/main.jsx` | Vite entry point. Mounts `<App />`. |
| `frontend/src/i18n.js` | Shared i18n helpers. |

### Frontend — v2 shell (the new combined system)

| Path | Role |
|---|---|
| `frontend/src/modules/v2-shell/ShellApp.jsx` | Top-level: TopBar + Sidebar + active module panel. Owns theme/lang state. Polls `GET /return-requests?status=pending` every 60s for the sidebar BR badge. |
| `frontend/src/modules/v2-shell/TopBar.jsx` | Logo, clock, lang toggle, theme toggle, user chip. Mirrors mockup lines 716–745. |
| `frontend/src/modules/v2-shell/Sidebar.jsx` | Find Borrow / BR Return module switch + badge counts. Mirrors mockup lines 750–779. |
| `frontend/src/modules/v2-shell/FBPanel.jsx` | Find Borrow panel. Mounts `<SaleView />` and `<AdminView />` directly (no iframe). Owns Sale/Admin tab state. |
| `frontend/src/modules/v2-shell/BRPanel.jsx` | BR Return panel. Renders `<iframe src=…/br-return>`. **Holds the iframe cache key.** Implements postMessage bridge for theme/lang. |
| `frontend/src/modules/v2-shell/shellTokens.css` | All v2 design tokens (`--v2-brand`, `--v2-card`, etc.) and shell layout CSS. |

### Frontend — Find Borrow module

| Path | Role |
|---|---|
| `frontend/src/modules/find-br/SaleView.jsx` | Sale-facing dashboard: customer list, alerts, BR badges. Used by both `FBPanel` (v2) and `DesktopApp` (legacy). |
| `frontend/src/modules/find-br/AdminView.jsx` | Admin dashboard: sync logs, KPIs, donut, sale summary, top-N tables. Used by both `FBPanel` (v2) and `DesktopApp` (legacy). |
| `frontend/src/modules/find-br/useFindBrData.js` | Custom hook that fetches all Find Borrow data (`/customers`, `/sync-logs`, `/analytics/summary`, `/analytics/customer-value`, `/sync-health`). Used by `FBPanel`. |
| `frontend/src/modules/find-br/CustomerModal.jsx`, `BRDetailModal.jsx` | Restyled detail modals (2026-05-19). |

### Frontend — mobile

| Path | Role |
|---|---|
| `frontend/src/mobile/MobileApp.jsx` | Real mobile app for Sale. **5 bottom tabs** (Home / Customers / Alerts / **Returns** / Profile). Hosts `CustomerDetailSheet` with BR list + BR Detail + Request Return CTA. Owns `submittedRequest` state for the post-submit success view. Phase 5 wired the Returns tab + Request Return CTA additively — the original 4 tabs are byte-identical to pre-Phase-5. |
| `frontend/src/mobile/MobilePrototypeApp.jsx` | **Deprecated but still mounted at `?prototype=1`.** localStorage-only Mobile BR Return prototype. Source of building blocks for Phase 5 extraction. Kept until Phase 6 cleanup confirms no one relies on it. **Do not edit in place** — extract to `br-return/` instead. |

#### `frontend/src/mobile/br-return/` — Phase 5 production module

Self-contained module imported by `MobileApp.jsx`. Reuses `POST /return-requests` (the same endpoint Desktop BR Return uses) — no backend or Apps Script changes.

| Path | Role |
|---|---|
| `frontend/src/mobile/br-return/README.md` | Module overview, design contract, file map. |
| `frontend/src/mobile/br-return/constants.js` | `STATUS_META` (pending / approved / rejected / cancelled palettes), `RETURN_TYPES` (RETURN / CLAIM / SALE / FREE — FREE color hardened to `#7F77DD` so it's visible in light mode), `typeLabel`, `breakdownFor`, `itemIdentity`, `buildApprovedFullView`. |
| `frontend/src/mobile/br-return/helpers.js` | `genReturnId` (deprecated — used only as a legacy fallback; `api.js:nextReturnId` is the canonical generator), `todayDateSort`, Thai/EN month + day arrays, `fmtDate`, `fmtDateTime`, `fmtShortDate`, `fmtDayMonth`, `startOfDay`, `sameDay`, `compressImageFile`, `approxAttachmentBytes`. |
| `frontend/src/mobile/br-return/api.js` | `loadReturnRequests(saleName)` (GET + client-side sale filter), `nextReturnId()` (fresh GET → max numeric suffix + 1 → `RT-YYYYMMDDNNNN`, same daily series as Desktop), `submitReturnRequest(payload)` (UPSERT, **unwraps** `{success, request}` so callers see the row directly). Comprehensive JSDoc on payload field names. |
| `frontend/src/mobile/br-return/shared.jsx` | `Icon`, `BottomSheet` — copies of the same primitives in `MobileApp.jsx`. Both copies have the same `paddingBottom: calc(env(safe-area-inset-bottom, 8px) + 56px)` safe-area fix; **must stay in sync**. |
| `frontend/src/mobile/br-return/components.jsx` | `ReturnStatusPill`, `RevisionChip`, `ImageLightbox`. |
| `frontend/src/mobile/br-return/ReturnsScreen.jsx` | The 5th-tab screen. KPI strip, search, status filter (KPI-driven), date range picker, list of returns, detail bottom sheet. Hosts the pending-status **Edit + Cancel** CTAs and the Cancel-reason modal. `displayRequestDate(r, lang)` rebuilds dates from `dateSort` for locale-aware display. |
| `frontend/src/mobile/br-return/RequestReturnSheet.jsx` | The 4-step submit form (Select → Allocate → Remark → Review). Used for new submissions, rejected-resubmit, **and pending-edit** (new). `editRejectedOnly` flag splits the editing flow into rejected-correction vs pending-edit, mirroring Desktop `br-return.html:4889-4892`. |
| `frontend/src/mobile/br-return/SuccessScreen.jsx` | Full-screen success view shown after a successful submit. Check icon, RT card (id / locale date / status pill), next-step note. `submittedRequest` state in `MobileApp.jsx` drives visibility; "Back to BR list" / "View All Requests →" footer destinations live in `MobileApp.jsx`. |

### Backend

| Path | Role |
|---|---|
| `backend/main.py` | FastAPI app. All endpoints. `MIGRATION_MODE` middleware. `ensure_tables()`. |
| `backend/sync_engine.py` | Apps Script `/sync` handler logic. Staging swap with 80% safety. |
| `backend/static/br-return.html` | **The BR Return UI.** ~6,500 lines of vanilla JS + CSS. Served from `/br-return`. Holds: Apps Script URL (line ~2333), pagination state, embedded-mode CSS, v2 bridge `v2ShellBridge`, the `BR_STRINGS`/`_t()` i18n dictionary (incl. all `db.*` Dashboard keys), and the **Dashboard tab** (search `renderDashboard` / `_renderDashboardHTML`). Tabs are driven by `switchTab(t)` (`sale`/`admin`/`dashboard`); `setLang()` re-renders the active tab; all three share `#main-content`. |

**Dashboard internals inside `br-return.html` (Phase D, search by name — line numbers drift):**

| Symbol | Role |
|---|---|
| `DASH_FILTERS` | `{ sale, year, month, mode }` — Dashboard-only filter state (separate from Sale/Admin `FILTERS`). |
| `dashboardQty(it)` / `dashboardItemValue(it)` | Per-item pieces / value (the QTY + value rules; counts pieces, not lines). |
| `dashboardRequestQty(r)` / `dashboardRequestValue(r)` | Σ over a request's `submittedItems`. |
| `normalizeStatus(s)` | → `approved`/`pending`/`rejected`/`cancelled`. |
| `parseDashboardDate(r)` | `{y,m,d,ds}` — prefers `created_at`, then `dateSort`, then `date` ISO. |
| `applyDashboardFilters(rows)` | Sale/Year/Month filtering. |
| `buildDashboardMetrics(rows)` | All KPI + type + sync aggregates. |
| `groupBySale` / `groupByDay` / `groupByMonth` / `groupReturnTypes` / `buildPendingAging` | Grouping helpers (NB: `groupByTeam`/`dashTeam`/`DASH_TEAMS` were **removed** in `ad7491a`). |
| `dashSetFilter` / `dashSetMode` / `dashClearFilters` | Filter event handlers → `renderDashboard()`. |
| `renderDashboard()` / `_renderDashboardHTML()` | try/catch wrapper + live HTML builder writing to `#main-content`. |
| `backend/requirements.txt` | Python deps. |
| `render.yaml` | `borrow-control-api` Render service definition. |

### Apps Script (external — not in repo)

| Function | Lives where | What it does |
|---|---|---|
| `syncBatch()` | Find Borrow Apps Script | Trigger entry. Reads next batch from Sheet, POSTs to `/sync`. Nightly-window gated. |
| `syncBatch(true)` | Same | Force-skip the window check. Manual recovery. |
| `resetSync()` | Same | Clears sync cursor state. |
| `manualFullSync()` | Same | Full recovery driver: reset + loop-until-done. **Never trigger.** |
| `setupTrigger()` | Same | Idempotently installs the minute trigger. |
| `doPost(e)` | BR Return Apps Script | Receives approval webhook from `br-return.html`. Branches on `isTest`. Writes back to Logistics File on production path. |

---

## 11. Safety rules for future AI agents (and humans)

These are **immutable** — if you find yourself wanting to bend one, stop and ask the user first. They exist because each has been costly to break in the past.

### Never modify without explicit permission

1. **BR Return Apps Script URL** in `br-return.html:2333`
2. **`backend/sync_engine.py`** write paths (`swap_staging_to_main`, 80% safety check)
3. **`POST /fix-content-duplicates`** in `backend/main.py:1067` — exists as a tripwire, must not be called
4. **`isTest=true` write-back gate** in the BR Return Apps Script
5. **Logistics File column mapping** — see `BR_CONTROL_HANDOFF.md` Section 2

### Never touch without explicit user approval

- Apps Script writeback (any change to write paths)
- Approval / correction / revision workflows in BR Return
- Supabase schema or connection-type choice (Session Pooler 5432 is the answer)
- Logistics File column meaning
- The `?prototype=1` isolation guarantees (mobile prototype must not write to backend)

### Test Mode rules

- Test Mode must NEVER write to the Logistics File
- Test request IDs must use `RT-T-` prefix
- Production approval must STILL write back correctly — Test Mode is a parallel branch, not a replacement
- If a code path could conceivably bypass `isTest=true` and reach production write-back, **stop and ask**

### Whenever `br-return.html` changes

1. **Bump the cache key** in `frontend/src/modules/v2-shell/BRPanel.jsx:32-33`. The convention is `v=br-<short-tag>-YYYYMMDD`.
2. **Verify BOTH modes:**
   - Standalone: open `borrow-control-1.onrender.com/br-return` directly — must look and behave like before (no v2 chrome bleed-through)
   - Embedded: open `borrow-control-app.onrender.com/` → click BR Return — iframe must load, theme/lang must sync, scroll must work
3. **Test the postMessage bridge** by toggling theme + lang in the topbar — iframe content should follow.
4. **Verify standalone scroll** is still internal (`#scroll-area`), and embedded scroll is the iframe document (natural flow).

### Rollback paths to keep in mind

- `?legacy=1` — desktop emergency rollback to the old DesktopApp
- Git tag `pre-v2-merge` — pre-Phase 1 snapshot (verify it exists on origin)
- Render dashboard → service → Deploys → "Rollback to previous" — one-click revert per service
- Standalone `/br-return` is always reachable, even if the shell breaks

### Pull-request etiquette / safety sweep

Before every commit that touches frontend or `br-return.html`, run these checks:

```
# No new direct Apps Script references outside br-return.html
git grep -n "script.google.com" -- 'frontend/**' 'backend/**' | grep -v 'br-return.html'
# Expected: empty (only br-return.html line 2333 should match)

# No new direct DB engine calls outside main.py / sync_engine.py
git grep -n "engine.execute\|engine.connect" -- 'backend/**' | grep -v -E 'main\.py|sync_engine\.py'
# Expected: empty

# No new /sync POST writes outside sync_engine.py
git grep -nE 'fetch.*"/sync".*POST|requests\.post.*"/sync"' -- 'frontend/**' 'backend/**' | grep -v sync_engine.py
# Expected: empty (only Apps Script and sync_engine should hit /sync)
```

### Examples of safe vs unsafe changes

| Safe ✅ | Unsafe ⚠️ |
|---|---|
| Adding a new column to a Find Borrow KPI card | Changing what `borrow_items.line_no` means |
| New BR Return filter or sort option | Bypassing the 80% safety check in `swap_staging_to_main` |
| Bumping pagination from 50 → 100 rows | Changing the BR Return Apps Script URL |
| CSS/layout fixes in embedded mode | Editing the postMessage bridge contract without coordinating both sides |
| New diagnostic GET endpoint | New POST endpoint that writes to `borrows` / `borrow_items` |
| Adding a translation key | Removing a translation key (breaks i18n coverage check) |
| Frontend Print BR layout tweak | Reconstructing Print BR data from `return_requests` (was explicitly rejected) |

---

## 12. Handoff discipline (going forward)

**The goal:** any AI agent or developer should be able to pick up where the last one left off by reading this document alone. To preserve that property, **update this file at the end of every completed task.**

### After every task, append/update:

1. **What changed** — one-line summary
2. **Files changed** — paths only
3. **Commits / branch names** — short hashes + branch name
4. **Verification result** — what was tested and how it behaved
5. **What was intentionally NOT changed** — restate the no-touch list
6. **Known risks** — anything that might bite in the future
7. **Next recommended step** — pointer to Section 9 row or new pending item

### Where to put updates

- **New milestone** → append to Section 8 (Completed work) and remove from Section 9 (Pending) if applicable
- **New safety rule discovered** → add to Section 11
- **New URL / env var / Render setting** → update Sections 1 / 3 / 7
- **New file of importance** → add row to Section 10
- **Architecture change** → update Section 2 (diagram + module roles)
- **Cache key bump** → log the new key in Section 2's "Recent cache keys" list

### Commit-message convention

We've been using Conventional Commits:
- `feat(scope): ...` — new feature
- `fix(scope): ...` — bug fix
- `chore(scope): ...` — non-behavior change (config, deps, cache key)
- `docs(scope): ...` — docs only
- `refactor(scope): ...` — code restructure with no behavior change

Recent scopes in active use: `brreturn`, `br-return`, `find-br`, `v2-shell`, `mobile`, `prototype`.

### Cross-reference policy

This doc and `BR_CONTROL_HANDOFF.md` should reference each other. The v1 doc covers the write-back invariants and the pre-shell architecture. This v2 doc covers the combined shell, Supabase, embedded mode, and post-cutover state. **Do not duplicate content** — link instead. If you find drift, fix this doc; the v1 doc is mostly frozen.

---

## 13. Deployment notes

### Auto-deploys

Both Render services auto-deploy on every push to `master`. Lead time:
- Static site (`borrow-control-app`) — ~60s to ~2min
- FastAPI (`borrow-control-api`) — ~90s to ~3min (cold builds longer)

### Coordinated deploys (frontend + `br-return.html`)

When a change spans both:

1. Bump the cache key in `BRPanel.jsx` in the **same commit** as the `br-return.html` change
2. Push to `master`
3. The Static Site deploys with the new cache key; the FastAPI service deploys the new HTML
4. **Order can race**, but it's self-healing — the next iframe load picks up whichever side is ready, and the cache key ensures the fresh HTML is requested

If you want a clean coordinated deploy, you can also push to a feature branch first, verify the Render preview, then merge.

### Local dev

```
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# (set DATABASE_URL env var first; use a dev Supabase project, NOT prod)

# Frontend
cd frontend
npm install
npm run dev
# VITE_API_URL defaults to http://localhost:8000
# VITE_BR_RETURN_URL defaults to http://localhost:8000/br-return
```

To test the v2 shell locally: open `http://localhost:5173/v2`.
To test standalone BR Return: open `http://localhost:8000/br-return`.

### Render env vars (production)

| Service | Var | Value |
|---|---|---|
| `borrow-control-api` | `DATABASE_URL` | Supabase Session Pooler URL on port 5432 |
| `borrow-control-api` | `MIGRATION_MODE` | `0` normally; `1` only during DB restores |
| `borrow-control-api` | `PYTHON_VERSION` | `3.12.13` |
| `borrow-control-app` (build) | `VITE_API_URL` | `https://borrow-control.onrender.com` |
| `borrow-control-app` (build) | `VITE_BR_RETURN_URL` | (default — only set if overriding) |

**Snapshot of these vars in a secure place** before any major work. Render does not version env vars.

---

## 14. Debugging tips & common pitfalls

### "BR Return iframe shows old version after deploy"

**Cause:** Iframe cached the old `br-return.html`.
**Fix:** Bump the cache key in `BRPanel.jsx:32-33`. Hard-refresh (Ctrl+Shift+R) for testing.

### "Print BR doesn't open / blocked / blank"

**Cause:** Cross-origin opener severing on the popup approach (Chrome 92+).
**Fix:** Already shipped — uses hidden in-page iframe (`_attachAndPrintInHiddenIframe` in `br-return.html`). If broken again, do NOT revert to `about:blank`/popup. Diagnose the iframe approach.

### "Theme/lang doesn't sync between shell and BR Return iframe"

**Cause:** postMessage bridge silent failure. Common reasons:
1. `e.origin` filter is too strict for a new hostname
2. Iframe hasn't fired `ready` yet (Shell sends without the iframe being mounted)
3. `try/catch` swallowed an error in `setTheme()`/`setLang()` inside iframe

**Debug:** Open DevTools → Console on both the parent and iframe (right-click in iframe → "Reload frame" → "Inspect" the frame). Add `console.log` in `BRPanel.jsx` `onMessage` handler and in the `v2ShellBridge` listener inside `br-return.html`.

### "Find Borrow shows stale data"

**Cause:** Nightly sync hasn't run or failed. Or `useFindBrData.js` is hitting a cached `localStorage` snapshot.
**Debug:** Check `/sync-health` for last sync time. Clear `localStorage` key `borrow-control:last-good-desktop-data` to force fresh fetch.

### "Render service is sleeping; first request takes 30+ seconds"

**Cause:** Render Free sleeps after ~15 min idle.
**Mitigation:** Apps Script `deadline: 240` absorbs cold-starts. For UI users, the loading state in `App.jsx` retries once after 700ms. Manager will upgrade to Render Basic; this disappears.

### "BR Return submit returns 503"

**Cause:** `MIGRATION_MODE=1` is on.
**Fix:** Check Render env vars on `borrow-control-api`. If migration is complete, set `MIGRATION_MODE=0` and restart.

### "Outstanding Value KPI doesn't match Sheet"

**Cause:** Could be (a) sync didn't fully complete; (b) filter is applied (numerator vs denominator); (c) duplicate-looking rows in Sheet were legitimate (don't dedup!).
**Diagnose:** Run `/value-debug` for a per-customer breakdown. Compare against Sheet pivot.

### "Sticky pending pill won't go away"

**Cause:** `sheet_sync='pending'` past the auto-retry window.
**Diagnose:** Click the retry button (smart-retry from `3f7a617`). If still stuck, check Apps Script execution log for the request's RT-ID.

### "Page header text wrong on combined shell"

**Cause:** Localized text lives in `PAGE_HEADER` constants inside `FBPanel.jsx` and `BRPanel.jsx`. Update both `th` and `en` keys.

### "Mobile RT-ID came out with `T-` prefix or `-XX` random suffix"

**Cause:** `nextReturnId()` failed silently (e.g. backend 5xx during the pre-submit fetch) and a legacy code path returned the old `genReturnId()` shape.
**Diagnose:** Open the live bundle and grep for `nextReturnId` + `include_test=false` — both should be present. Test by submitting from Mobile and inspecting the new RT-ID — must be `RT-YYYYMMDDNNNN` (4-digit running counter, no `T-`).
**Fix:** Production `isTest: false` payloads should NEVER produce `T-`. If the live bundle is missing `nextReturnId`, force-redeploy the latest master to Render. Hard-refresh phone.

### "Mobile success screen appears empty / behind another sheet"

**Cause:** Either (a) the `POST /return-requests` response unwrap regressed (so `submittedRequest.id / .dateSort / .custCode` are undefined), or (b) the BR Detail or Request Return BottomSheet didn't close when the parent customer dismissed.
**Diagnose:** Grep the live bundle for `typeof r=="object"&&r.request` (the unwrap conditional from commit `4bab64e`). Grep for the gated `open` conditions on both nested sheets in `MobileApp.jsx` (they must include `!!customer &&`). Look at the live bundle source.
**Fix:** Both fixes are in `4bab64e` + `06e82e2`. If the bundle is missing them, the merge didn't include the latest master.

### "Mobile date shows in Thai even after switching to English"

**Cause:** `ReturnsScreen.displayRequestDate()` fell back to rendering `r.date` as-is (which is a locale-baked Thai display string from the backend).
**Diagnose:** Confirm the helper prefers `r.dateSort` (BBBBMMDD INT4) and rebuilds the display in the current language. The fallback to `r.date` should only fire for legacy rows that lack `dateSort`.
**Fix:** Already shipped in commit `511aaf0`. If regressed, restore the dateSort-first order.

### "Mobile Returns tab shows '—' for every date"

**Cause:** `r.date` is an unparseable Thai display string (`"25 พ.ค. 2569"`) and `r.dateSort` is missing or zero.
**Diagnose:** `curl -s /return-requests | jq` — check that `dateSort` is present on each row.
**Fix:** Backend writes `dateSort` on every UPSERT. If missing, check `nextReturnId()` and `submitReturnRequest()` are sending it.

### "Mobile 'Back to BR list' opens the wrong sheet"

**Cause:** `CustomerDetailSheet` didn't reset `selectedBR` when the parent reopened.
**Diagnose:** Read `MobileApp.jsx` customer-change useEffect — must call `setSelectedBR(null)` and `setRequestReturnOpen(false)` on every non-null customer load.
**Fix:** Shipped in commit `f2a502d`.

### "Mobile pending Edit/Cancel buttons missing"

**Cause:** `selectedReq.status !== 'pending'` (already reviewed by Admin) OR a regression dropped the conditional block from `ReturnsScreen.jsx`.
**Diagnose:** Refresh the Returns tab (pull down). If the row's status is approved/rejected/cancelled, the CTAs are intentionally hidden. Open Desktop `/v2` BR Return → confirm whether Admin already touched it.
**Expected:** CTAs only appear when `selectedReq.status === "pending"`. Once Admin reviews, they disappear automatically.

### "Dashboard tab flips back to Admin after ~30 seconds"

**Cause:** A refresh/render path doesn't respect `ACTIVE_TAB`. The 30s `loadReturnRequests()` poll,
visibilitychange, or `applyBorrowMasterData()` re-rendered `#main-content` without a `dashboard`
branch.
**Fix:** Already shipped in `7e1991e` — both callbacks have `else if(ACTIVE_TAB==='dashboard') renderDashboard();`.
If it regresses, grep `br-return.html` for `renderAdminContent()` and ensure every async/timer
caller checks `ACTIVE_TAB` (the `switchTab`/`setLang` pattern). User-action-driven Admin renders
(approve/reject/cancel) are fine — they can't fire while Dashboard is active.

### "Dashboard shows mock numbers (142 / 3,410 / ฿1.42M) or an 'Unassigned' team"

**Cause:** Stale iframe HTML (pre-D3), OR a regression reintroduced Team/mock code.
**Fix:** Confirm the iframe cache key is `v=br-dashboard-d3-saleonly-20260527` (or newer). Hard-refresh.
The live dashboard reads real `RECENT` data, shows a green "Live data" badge (not the yellow "Mock"
badge), and renders no Team filter/chart/column and no "Unassigned"/"ไม่ระบุทีม" text.

### "Dashboard QTY looks too low / equals the number of item lines"

**Cause:** Someone changed `dashboardQty()` to count `submittedItems.length` instead of summing pieces.
**Expected:** QTY = Σ `item.quantity` (fallback `retQty+clmQty+saleQty+freeQty`) across all items —
e.g. 2 lines with qty 5 and 3 = **8 pieces**, not 2. This mirrors `requestItemQtyForPrint`.

### "Mobile bottom-sheet CTA is clipped behind the tab bar"

**Cause:** Either (a) the safe-area `paddingBottom` regressed in one of the two BottomSheet copies (`MobileApp.jsx` + `br-return/shared.jsx`), or (b) iOS Safari isn't honoring `env(safe-area-inset-bottom)` on a custom phone profile.
**Diagnose:** Grep the live bundle for `safe-area-inset-bottom` — must appear ≥ 6 times. The two BottomSheet copies should each contribute `calc(env(safe-area-inset-bottom, 8px) + 56px)` on the children container.
**Fix:** Both copies share the same fix in `74af5ab`. Restore if regressed.

---

## 15. Verification checklist (after any UI change)

Use this before merging anything that touches the shell or BR Return:

- [ ] `npm run build` succeeds locally with no warnings about missing imports
- [ ] Safety sweep (Section 11) — three grep commands return empty
- [ ] Bare URL `https://borrow-control-app.onrender.com/` loads on desktop → shows v2 combined shell
- [ ] Click "Find Borrow" → Sale view loads with customer list
- [ ] Click "Admin" tab in Find Borrow → KPIs + sync logs render
- [ ] Click "BR Return" in sidebar → iframe loads (no chrome bleed, no double sidebar)
- [ ] Toggle theme in topbar → both Find Borrow side AND BR Return iframe respond
- [ ] Toggle lang TH ↔ EN → both sides translate
- [ ] In BR Return → scroll down naturally → pagination bar visible at the bottom of the table
- [ ] Click pagination Next → page 2 of requests visible
- [ ] Click "ดูรายละเอียด" on a request → detail modal opens
- [ ] **BR Return Dashboard tab** → loads beside Sale/Admin (purple dot); green "Live data" badge, real numbers (not mock)
- [ ] **Dashboard stays put** → wait 30–60s on the tab → does NOT flip back to Admin
- [ ] **Dashboard filters** → Sale / Year / Month / Daily↔Monthly recompute KPIs + charts; **no Team filter** present
- [ ] **Dashboard has no Team** → no Team Performance chart, no Team column in tables, no "Unassigned" text; a "Top Sale by Requests" card is present
- [ ] **Dashboard QTY** → Submitted QTY counts pieces, not item-lines; Total Requests matches the Sale/Admin list under the same filter
- [ ] **Dashboard TH↔EN + light/dark** → labels translate and palette switches
- [ ] (Sale path) Create a test request → lands in DB with `RT-T-` prefix → `sheet_sync` stays `not_applicable`
- [ ] (Admin path) Approve a non-test request → Apps Script log shows the call; `sheet_sync` goes `synced`; corresponding Logistics File rows flip to `WAIT`
- [ ] `?legacy=1` → old `DesktopApp` renders unchanged
- [ ] Standalone `/br-return` → no v2 chrome bleed-through; original layout intact
- [ ] **Mobile viewport** → 5 bottom tabs (Home / Customers / Alerts / Returns / Profile, Profile last)
- [ ] **Mobile Returns tab** → KPI strip + list render; tab-bar pink dot only when pending count > 0
- [ ] **Mobile Customer → BR Detail** → `↩ ขอคืนสินค้า` outline CTA above filled-pink `Export PDF`
- [ ] **Mobile submit flow** → 4-step form → submit succeeds → full-screen success view with real RT-ID `RT-YYYYMMDDNNNN`
- [ ] **Mobile Back to BR list** (success view footer) → reopens the SAME customer's BR LIST (not Customer list, not BR Detail)
- [ ] **Mobile View All Requests →** (success view footer) → switches to Returns tab with fresh RT at top
- [ ] **Mobile pending detail sheet** → shows `Cancel request` + `↻ Edit request` CTAs
- [ ] **Mobile cancel flow** → modal opens → reason required → confirm → status flips to cancelled; row visible in Desktop `/v2` with same reason
- [ ] **Mobile edit-pending flow** → 4-step form pre-selects items with blank quantities → save → same RT-ID retained → status remains pending
- [ ] **Mobile TH↔EN toggle** → dates re-render in active language on the Returns list, detail header, and success card
- [ ] **`?prototype=1`** → still launches `MobilePrototypeApp` unchanged

### Phase 5 (Mobile BR Return) rollback path

Safe one-step revert of the entire Phase 5 surface:

```bash
# List the 9 Phase 5 commits to confirm scope
git log --oneline master ^a1ebcd5  # ← any commit BEFORE 7fc9854 works as base

# Revert just the latest Mobile-BR-Return merge (incremental rollback)
git revert -m 1 3260966       # undoes the latest "Edit + Cancel" feature only
# OR
git revert -m 1 b9a21a6..3260966   # undoes Phase 5 fixes (keeps Step 1+2 modules)
# OR (nuclear — remove all of Phase 5):
git revert -m 1 50ba484       # undoes the wiring; modules become dead code but harmless

git push origin master         # Render auto-redeploys ~3-6 min
```

**No DB cleanup needed for any rollback** — any submissions made from Mobile stay valid in the
`return_requests` table and remain visible/usable on Desktop. Admin can still approve them; the
writeback chain to the Logistics File is unaffected.

The two-branch trail (`feat/mobile-br-return-prep` extraction + the various `fix/*` branches)
stays on GitHub for re-attempt or partial cherry-pick.
- [ ] `?prototype=1` on mobile viewport → `MobilePrototypeApp` renders; localStorage isolation holds

---

## 16. Quick-reference index

| Need | Section |
|---|---|
| Which URL is "main"? | Section 1 |
| How does the iframe communicate with the shell? | Section 2 (postMessage bridge) |
| Why is the cache key in BRPanel.jsx? | Section 2 (cache key strategy) |
| Which Render service does what? | Section 3 |
| Why Session Pooler 5432 and not 6543? | Section 4 |
| When can I call `manualFullSync`? | Section 5.1 |
| How do I verify a nightly sync? | Section 5.3 |
| What does Test Mode do? | Section 6 |
| How do I safely run a DB restore? | Section 7 (MIGRATION_MODE) |
| What's already done? | Section 8 |
| How does the BR Return Dashboard work / where's its code? | Section 8 (Phase D) + Section 10 (`br-return.html` internals) |
| What's next? | Section 9 |
| Which file does X? | Section 10 |
| Can I change Y? | Section 11 (safety rules) |
| How do I update this doc? | Section 12 |
| How do I deploy? | Section 13 |
| Why is BR Return showing stale HTML? | Section 14 (debugging) |
| What do I run before merging? | Section 15 (checklist) |

---

*End of document. Companion: [`BR_CONTROL_HANDOFF.md`](BR_CONTROL_HANDOFF.md) for write-back invariants and Logistics File schema. Keep both alive; this doc supersedes the v1 doc for architecture and process, but not for write-back rules.*
