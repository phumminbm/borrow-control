// =============================================================================
// shared.jsx — Shared UI primitives for the Mobile BR Return module
//
// Exports: Icon, BottomSheet
//
// These are copies of the same components in MobileApp.jsx (lines 54-140).
// They live here so the br-return module is self-contained during Phase 5
// Step 1 (extraction-only, MobileApp.jsx not yet modified).
//
// ── Step 2 refactor note ──────────────────────────────────────────────────
// When MobileApp.jsx is updated in Step 2 to wire in the BR Return screens,
// export Icon and BottomSheet from MobileApp.jsx (or move them to a shared
// mobile utilities file) and update imports in this module accordingly.
//   import { Icon, BottomSheet } from "../MobileApp";  // after Step 2
// =============================================================================

// ── Icon ──────────────────────────────────────────────────────────────────────
export function Icon({ name, size = 20, color = "currentColor" }) {
  const icons = {
    home:     <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>,
    users:    <><circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><circle cx="16" cy="7" r="2.5" stroke={color} strokeWidth="1.6" fill="none"/><path d="M21 18c0-2.5-1.8-4.5-4-5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    bell:     <><path d="M6 16V10a6 6 0 1112 0v6l2 2H4l2-2z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M10 20a2 2 0 004 0" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    user:     <><circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.6" fill="none"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    search:   <><circle cx="11" cy="11" r="7" stroke={color} strokeWidth="1.6" fill="none"/><path d="M20 20l-4-4" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></>,
    filter:   <path d="M3 5h18l-7 9v6l-4-2v-4L3 5z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>,
    chevron:  <path d="M9 6l6 6-6 6" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    close:    <path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/>,
    alertTri: <><path d="M12 3l10 17H2L12 3z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M12 10v5M12 17v.01" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 10h18M8 3v4M16 3v4" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    check:    <path d="M5 12l5 5L20 7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    moon:     <path d="M20 14a8 8 0 01-10-10 8 8 0 1010 10z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>,
    globe:    <><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" fill="none"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" stroke={color} strokeWidth="1.6" fill="none"/></>,
    refresh:  <><path d="M4 10V5h5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><path d="M20 14v5h-5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/><path d="M4 10a8 8 0 0115-1M20 14a8 8 0 01-15 1" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/></>,
    trend:    <><path d="M3 17l6-6 4 4 8-8" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 7h7v7" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: "block" }}>{icons[name]}</svg>;
}

// ── BottomSheet ───────────────────────────────────────────────────────────────
export function BottomSheet({ open, onClose, children, title, height = "85%", dark = true }) {
  const sheetBg  = dark ? "#141414" : "#ffffff";
  const handleBg = dark ? "#333"    : "#e0e0e0";
  const titleBdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const titleCol = dark ? "#eee"    : "#111";
  const closeCol = dark ? "#888"    : "#666";
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: open ? "rgba(0,0,0,0.5)" : "transparent", backdropFilter: open ? "blur(2px)" : "none", transition: "background 0.25s", pointerEvents: open ? "auto" : "none", zIndex: 200 }}
      />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height, background: sheetBg, borderRadius: "20px 20px 0 0", transform: open ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s cubic-bezier(.32,.72,0,1)", zIndex: 201, display: "flex", flexDirection: "column", boxShadow: "0 -8px 40px rgba(0,0,0,0.25)", maxHeight: "92vh" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: handleBg, borderRadius: 2 }} />
        </div>
        {title && (
          <div style={{ padding: "10px 20px 12px", borderBottom: `0.5px solid ${titleBdr}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: titleCol }}>{title}</div>
            <button onClick={onClose} style={{ border: "none", background: "transparent", color: closeCol, fontSize: 14, cursor: "pointer", padding: 4 }}>✕</button>
          </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>{children}</div>
      </div>
    </>
  );
}
