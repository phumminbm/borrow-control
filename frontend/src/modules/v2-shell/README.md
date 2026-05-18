# modules/v2-shell

The combined Desktop shell that hosts both Find BR and BR Return under one UI.

## Status

**Empty until Phase 2.** This folder will contain:

```
v2-shell/
├── ShellApp.jsx          ← top-level: TopBar + Sidebar + ContentPanel
├── TopBar.jsx            ← logo, clock, lang toggle, theme toggle, user chip
├── Sidebar.jsx           ← Find Borrow / BR Return module switcher
├── FBPanel.jsx           ← mounts SaleView + AdminView with tab switching
├── BRPanel.jsx           ← iframe to br-return.html + postMessage bridge
└── shellTokens.css       ← CSS design tokens from the mockup
```

## Visual reference

`docs/mockups/Borrow_Mockup_Combine_Modules.html` — ERP-styled mockup that defines the topbar, sidebar, color tokens, and module-panel structure.

## Activation

After Phase 2, the shell is reached via:

```
borrow-control-app.onrender.com/v2
borrow-control-app.onrender.com/?v=2
```

After the Phase 4 cutover, the shell becomes the default desktop view (no flag needed). The old DesktopApp remains accessible at `?legacy=1` for at least 2 weeks post-cutover.

## Design principles

1. **The shell does not own business logic.** It mounts existing modules and brokers cross-module concerns (theme, lang, badge counts).
2. **Iframe boundary is sacred.** The shell never reaches into the BR Return iframe to manipulate its DOM. All communication goes through `postMessage`.
3. **Backwards compatible.** Removing the shell (`?legacy=1`) must always restore exact pre-merge behavior.
