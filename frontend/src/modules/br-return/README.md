# modules/br-return

Integration layer for the **BR Return** module.

## Architecture

BR Return is a 4,981-line vanilla-JS application that lives at `backend/static/br-return.html`. It is **not** a React component. It has been production-tested and handles:

- BR Return submissions (Sale side)
- Approval / rejection / correction (Admin side)
- Apps Script webhook → Logistics File write-back
- Revision history tracking
- Photo attachments
- TH/EN bilingual UI

## How it integrates into the React shell

After Phase 2, the v2-shell wraps BR Return in an iframe:

```jsx
// modules/v2-shell/BRPanel.jsx (Phase 2)
<iframe
  src="https://borrow-control-1.onrender.com/br-return"
  // theme + lang sync via postMessage
/>
```

This folder currently contains only this README. The actual integration component (`BRPanel.jsx`) lives under `modules/v2-shell/`. The folder exists to:

1. Document the **iframe-embed contract** (not a React port)
2. Hold future React-side helpers if any are extracted (e.g. a hook to talk to the iframe via postMessage)

## postMessage contract

| Direction | Type | Payload |
|---|---|---|
| Shell → iframe | `theme:set` | `{ theme: 'dark' \| 'light' }` |
| Shell → iframe | `lang:set` | `{ lang: 'th' \| 'en' }` |
| iframe → Shell | `ready` | `{}` |
| iframe → Shell | `badge:update` | `{ pendingCount: number }` |

The iframe-side listener lives at the bottom of `backend/static/br-return.html` (added in Phase 2). It is wrapped in `try/catch` so direct standalone access to `/br-return` still works.

## Do not

- Do not port `br-return.html` to React unless the user explicitly requests it
- Do not modify the Apps Script URL constant inside `br-return.html`
- Do not introduce a second source of truth for the BR Return workflow

## Standalone access

`https://borrow-control-1.onrender.com/br-return` remains a working standalone URL throughout the v2 merge — it is the emergency rollback path if the iframe wrapper breaks for any reason.
