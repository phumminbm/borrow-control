# modules/find-br

React module for the **Find Borrow** feature (a.k.a. Find BR).

## Files

| File | Role |
|---|---|
| `SaleView.jsx` | Sale-facing customer list with KPIs, search, status filters, BR drill-down |
| `AdminView.jsx` | Admin-facing dashboard with sync logs, team donut, per-Sale summaries, Top-N tables |

## Data flow

- `GET /customers` — full customer list with computed status (BLOCK / WARNING / NORMAL)
- `GET /sync-logs` — nightly sync history (Admin view only)
- `GET /sync-health` — sync engine health (Admin view only)
- `GET /analytics/summary` — aggregate stats
- `GET /analytics/customer-value` — per-customer outstanding value

All endpoints are **read-only**. Neither view writes back to the backend.

## How it's mounted

Currently mounted directly inside `src/App.jsx`'s `DesktopApp` component. After the v2-shell merge (Phase 4), they will be mounted via `modules/v2-shell/FBPanel.jsx` with the same prop contract.

## Shared imports

Both views import `StatusBadge`, `T` (i18n table), `SC` (status colors), `TEAMS`, `TEAM_COLORS` from `../../App` (the root `src/App.jsx`). Do not duplicate those constants — keep one source of truth in `App.jsx` until the Phase 1.5 i18n/theme extraction lands.
