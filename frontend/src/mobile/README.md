# mobile/

Mobile-only React components.

## Files

| File | Role | Status |
|---|---|---|
| `MobileApp.jsx` | Production mobile Sale app (4 bottom tabs, real backend) | Production |
| `MobilePrototypeApp.jsx` | Mobile BR Return prototype with localStorage-only writes | Gated by `?prototype=1` |

## Activation

| URL | Renders |
|---|---|
| Mobile viewport (`< 768px`) at any bare URL | `MobileApp` |
| `?prototype=1` | `MobilePrototypeApp` (overrides viewport detection) |

Both files import `TEAMS` / `TEAM_COLORS` from `../App.jsx` and remain at depth 1 under `src/` (same depth as the prior `components/` location) — no import-path adjustments needed during the v2 folder reorganization.

## Phase 5 plan

After the Phase 4 cutover stabilizes, BR Return features that were validated in the prototype will be promoted into `MobileApp.jsx`:

1. Extract reusable building blocks (e.g. `ReturnsScreen`, `RequestReturnSheet`, status meta dict) into `mobile/br-return/`
2. Wire them into `MobileApp.jsx` as new screens — never modify the existing 4-tab structure that production users rely on
3. Critically, the new mobile submit path must call **the real `POST /return-requests`** backend endpoint, not localStorage

The prototype file stays in place (gated by `?prototype=1`) as the playground for future iterations.
