# Backup/

This folder holds files that are no longer active in production but are kept on disk for reference, rollback, or maintenance work.

**Files here are not loaded by Vite, not served by FastAPI, and not imported by any active module.** They exist purely as a historical archive.

## When files get moved here

| Scenario | Action |
|---|---|
| A React file is rewritten and the old version is no longer imported anywhere | Move `OldFile.jsx` → `Backup/legacy-react/OldFile.jsx` |
| A static HTML mockup or showcase is superseded | Move `Old_Mockup.html` → `Backup/mockups/` |
| A prototype is promoted into production and the prototype gate is removed | Move the original prototype source here |
| A deprecated endpoint is removed from `main.py` | Keep the removed code as a commented block in a snapshot file under `Backup/backend-removed-endpoints/` |

**Never delete files** — always move them here first. Once a quarter, the user can review `Backup/` and decide what to archive elsewhere or purge.

## Current contents

(empty — populated as the v2 merge progresses)

## Subfolder convention

```
Backup/
├── README.md                          (this file)
├── legacy-react/                      Old React components after Phase 4 cutover
├── mockups/                           Superseded HTML mockups
├── backend-removed-endpoints/         Endpoints removed from main.py (annotated copies)
└── prototypes/                        Prototype code after promotion to production
```

## Rollback contract

If a phase needs to be rolled back:

1. Git tags exist for every cutover (e.g. `pre-v2-merge`, `pre-v2-cutover`, etc.).
2. `Backup/legacy-react/` contains the exact pre-merge versions of any rewritten component, ready to restore in place.
3. The `?legacy=1` URL parameter on `borrow-control-app.onrender.com/` should remain functional for at least 2 weeks after each cutover.

## Related

- `pre-v2-merge` tag on GitHub: snapshot of `master` at commit `52e5276` (before any v2 merge work began)
- Active production code: `frontend/src/` and `backend/`
- The merge plan: `C:\Users\USER\.claude\plans\fluttering-kindling-thompson.md`
