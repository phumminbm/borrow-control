# Mobile BR Return Module

Self-contained React module for the Mobile BR Return surface.

Extracted from `MobilePrototypeApp.jsx` in **Phase 5 Step 1** (2026-05-24).
Step 2 will graft these screens into `MobileApp.jsx` as additive features
(new 5th tab + CTA button in CustomerDetailSheet) without modifying existing
mobile screens.

## File map

| File | Purpose |
|------|---------|
| `constants.js` | STATUS_META, RETURN_TYPES, typeLabel, breakdownFor, itemIdentity, buildApprovedFullView |
| `helpers.js` | genReturnId, date helpers, calendar constants, image compression |
| `components.jsx` | ReturnStatusPill, RevisionChip, ImageLightbox |
| `api.js` | loadReturnRequests (GET), submitReturnRequest (POST/UPSERT) |
| `shared.jsx` | Icon, BottomSheet — copied from MobileApp.jsx for Step 1 self-containment |
| `RequestReturnSheet.jsx` | 4-step return request form (Select → Allocate → Remark → Review/Submit) |
| `ReturnsScreen.jsx` | Returns list with KPI strip, search/filter, date range picker, detail sheet |

## Backend contract

```
GET  /return-requests?limit=500&include_test=false
     → All non-test requests. Client filters by r.sale === sale.

POST /return-requests   (UPSERT)
     Body: { requestId, custCode, custName, brNo, sale,
             status, dateSort, remark, submittedItems,
             attachments, revisionHistory, isTest: false, ... }
     → Persisted record.
```

## Key design decisions

### Production vs prototype differences
- `isTest: false` always — production submissions go to the real Admin queue
- `genReturnId()` generates `RT-YYYYMMDDHHMMSS-RR` (no `RT-T-` test prefix)
- `submitReturnRequest()` calls real backend; no localStorage
- `dateSort` uses Buddhist-year BBBBMMDD integer (INT4-safe; `Date.now()` overflows)

### Date filter fix
The prototype compared `Date.getTime()` (Unix ms ≈ 1.7e12) against `r.dateSort`
(BBBBMMDD ≈ 2.5e7) — incompatible scales, filter never matched.
Fixed in `ReturnsScreen.jsx` via `dateToBuddhistInt(d)`.

### Field aliases
The backend and Desktop BR Return use camelCase (`requestId`, `custName`, `brNo`).
Mobile detail views use both camelCase and snake_case aliases (`custName`/`cust`,
`brNo`/`br`, `requestId`/`id`). Both shapes are read defensively throughout.

### shared.jsx — Step 2 note
`Icon` and `BottomSheet` are duplicated from `MobileApp.jsx` so this module
is self-contained during Step 1. When Step 2 wires the module into `MobileApp.jsx`,
export those components from a shared location and update the import here:
```js
import { Icon, BottomSheet } from "../shared";  // after Step 2 refactor
```

## Step 2 integration checklist (future)

These are the tasks for `feat/mobile-br-return-wire`:

- [ ] Add "คืนสินค้า" (5th) tab to `MobileApp.jsx` bottom nav
- [ ] Mount `<ReturnsScreen>` for that tab, passing `sale`, `returns` (from
      `loadReturnRequests`), `refreshReturns`, `setReturnsCount`
- [ ] Add "ขอคืนสินค้า" CTA button to `CustomerDetailSheet`'s BR detail section
      in `MobileApp.jsx`, opening `<RequestReturnSheet>`
- [ ] Poll `loadReturnRequests(sale)` on mount + on tab focus
- [ ] Wire tab badge from `setReturnsCount` to the bottom-nav BR tab
- [ ] After Step 2 stable, update `shared.jsx` import to use shared location
- [ ] Verify: all 4 existing mobile tabs unchanged
- [ ] Verify: submissions land in Desktop Admin queue with correct RT-ID
- [ ] Verify: resubmit updates existing record (UPSERT), Admin sees corrected items
- [ ] Verify: `?prototype=1` still launches `MobilePrototypeApp` unchanged
