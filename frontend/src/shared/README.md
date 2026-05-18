# shared/

Cross-module utilities (Phase 2+).

## Status

**Empty until Phase 2.** Planned contents:

- `themeContext.js` — React context for dark/light theme, with localStorage persistence
- `langContext.js` — React context for TH/EN, syncs with `i18n.js` dictionary
- `apiClient.js` — small wrapper around `fetch(VITE_API_URL + path)` with retry + cache fallback (extracted from current `App.jsx` `fetchJson()` helper)
- `postMessageBridge.js` — typed helpers for the shell ↔ iframe messages

## Rules

- Files here must be **stateless or context-based** — no module-level mutable state
- Imports must work from anywhere in `src/` without relative-path gymnastics — keep this folder direct under `src/`
- Do not import from `modules/` or `mobile/` — `shared/` must remain a leaf with no circular dependencies
