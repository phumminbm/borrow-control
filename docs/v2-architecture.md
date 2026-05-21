# BR Control v2 — Architecture & Handoff Document

**Last updated:** 2026-05-20
**Status:** Production. Combined v2 shell live at `/`. Supabase migration complete. BR Return embedded mode polished. Awaiting first full nightly sync on Supabase tonight.
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
- `v=br-natural-20260520` — current; natural document flow in embedded mode

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

---

## 9. Pending / future work

### High priority (passive — just watch)

| # | Item | When | What to do |
|---|---|---|---|
| 1 | **Monitor tonight's first full nightly sync on Supabase** | Tonight 23:30 Bangkok | Tomorrow morning: check `/sync-health`, `/sync-logs`, Outstanding Value, BR Active count. See Section 5.3. |

### Medium priority (next sprint candidates)

| # | Item | Plan phase | Notes |
|---|---|---|---|
| 2 | **Task 2 — Mobile BR Return promotion into `MobileApp.jsx`** | Plan Phase 5 | Gated on 3-day Phase 4 stability. Two-branch approach: (a) `feat/mobile-br-return-prep` — extract reusables from `MobilePrototypeApp.jsx` → `frontend/src/mobile/br-return/`; (b) `feat/mobile-br-return-wire` — graft into `MobileApp.jsx` as additive screens, real `POST /return-requests`. Keep `?prototype=1` working. |

### Lower priority (cleanup)

| # | Item | Plan phase | Notes |
|---|---|---|---|
| 3 | **`ensure_tables()` refactor out of per-request paths** | — | Currently called inside request handlers (which is why `MIGRATION_MODE` had to block them). Refactor to call once at app startup. Quality-of-life cleanup; not urgent because `MIGRATION_MODE` covers the failure mode. |
| 4 | **Remove `?legacy=1` gate** | Phase 6 | Wait until Phase 4 has been stable for 2 weeks (target: ~2026-06-02). Drop `isLegacyMode()` and `DesktopApp` import from `App.jsx`. |
| 5 | **Retire `/v2` alias** | Phase 6 | Wait until manager confirms no one is using the alias. Drop `isV2Mode()`. |
| 6 | **Move legacy files into `Backup/`** | Phase 6 | Once Phase 5 ships and absorbs `MobilePrototypeApp.jsx`'s features — move, don't delete (user's explicit rule). |
| 7 | **Update `BR_CONTROL_HANDOFF.md` system map** | Phase 6 | Add a "see also: v2-architecture.md" pointer to the v1 doc. The v1 doc's invariants are still load-bearing for write-back. |
| 8 | **Keep this doc current** | Ongoing | See Section 12 — handoff discipline. |

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
| `frontend/src/mobile/MobileApp.jsx` | Real mobile app for Sale. 4 bottom tabs. **Phase 5 will add BR Return screens here — additive only, do not modify the existing 4-tab structure.** |
| `frontend/src/mobile/MobilePrototypeApp.jsx` | Standalone Mobile BR Return prototype. Activated by `?prototype=1`. **localStorage only** — does not write to backend. Isolated from real Admin queue. Source of building blocks for Phase 5 extraction. |

### Backend

| Path | Role |
|---|---|
| `backend/main.py` | FastAPI app. All endpoints. `MIGRATION_MODE` middleware. `ensure_tables()`. |
| `backend/sync_engine.py` | Apps Script `/sync` handler logic. Staging swap with 80% safety. |
| `backend/static/br-return.html` | **The BR Return UI.** 5,989 lines of vanilla JS + CSS. Served from `/br-return`. Holds: Apps Script URL (line 2333), pagination state (line 2702+), embedded-mode CSS (line 1300+), v2 bridge `v2ShellBridge` (line ~5927). |
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
- [ ] (Sale path) Create a test request → lands in DB with `RT-T-` prefix → `sheet_sync` stays `not_applicable`
- [ ] (Admin path) Approve a non-test request → Apps Script log shows the call; `sheet_sync` goes `synced`; corresponding Logistics File rows flip to `WAIT`
- [ ] `?legacy=1` → old `DesktopApp` renders unchanged
- [ ] Standalone `/br-return` → no v2 chrome bleed-through; original layout intact
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
| What's next? | Section 9 |
| Which file does X? | Section 10 |
| Can I change Y? | Section 11 (safety rules) |
| How do I update this doc? | Section 12 |
| How do I deploy? | Section 13 |
| Why is BR Return showing stale HTML? | Section 14 (debugging) |
| What do I run before merging? | Section 15 (checklist) |

---

*End of document. Companion: [`BR_CONTROL_HANDOFF.md`](BR_CONTROL_HANDOFF.md) for write-back invariants and Logistics File schema. Keep both alive; this doc supersedes the v1 doc for architecture and process, but not for write-back rules.*
