// =============================================================================
// components.jsx — Small shared UI components for the Mobile BR Return module
//
// Exports: ReturnStatusPill, RevisionChip, ImageLightbox
//
// These are lifted verbatim from MobilePrototypeApp.jsx with prototype-only
// scaffolding removed (PrototypeBadge, simulate-admin markers, etc.).
// =============================================================================

import { useState, useEffect } from "react";
import { STATUS_META } from "./constants";

// ── ReturnStatusPill ─────────────────────────────────────────────────────────
// Renders a colored pill for return-request status: pending / approved /
// rejected / cancelled. Matches the Desktop BR Return status palette.
export function ReturnStatusPill({ status, size = "sm", lang = "th" }) {
  const m  = STATUS_META[status] || STATUS_META.pending;
  const sz = size === "xs"
    ? { px: 6, py: 1, fs: 9,  dot: 5 }
    : { px: 8, py: 2, fs: 10, dot: 5 };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: m.bg, color: m.color,
      border: `0.5px solid ${m.border}`,
      borderRadius: 5,
      padding: `${sz.py}px ${sz.px}px`,
      fontSize: sz.fs, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <span style={{ width: sz.dot, height: sz.dot, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
      {lang === "th" ? m.label_short_th : m.label_en}
    </span>
  );
}

// ── RevisionChip ─────────────────────────────────────────────────────────────
// Small chip displayed next to the request ID when a request has been revised
// (revisionHistory.length >= 2). Returns null for first-time submissions.
export function RevisionChip({ rev, lang = "th" }) {
  if (!rev || rev < 2) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 9, fontWeight: 700, color: "#D4357A",
      background: "rgba(212,53,122,0.12)",
      border: "0.5px solid rgba(212,53,122,0.45)",
      borderRadius: 5, padding: "1px 6px",
      letterSpacing: 0.4, textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>
      ↻ {lang === "th" ? "แก้ไขครั้งที่" : "Rev"} {rev}
    </span>
  );
}

// ── ImageLightbox ─────────────────────────────────────────────────────────────
// Full-screen image viewer. Tap anywhere to close. Left/right tap zones advance
// the gallery when there are multiple attachments. Sits above bottom sheets
// via zIndex 9999.
//
// Props:
//   open        {boolean}   Mount / unmount the overlay
//   sources     {Array}     Array of { data: dataURL, name: string }
//   startIndex  {number}    Which image to open at (default 0)
//   onClose     {function}  Called when user taps ✕ or the backdrop
export function ImageLightbox({ open, sources, startIndex = 0, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  useEffect(() => { if (open) setIdx(startIndex); }, [open, startIndex]);

  if (!open || !Array.isArray(sources) || sources.length === 0) return null;

  const safeIdx = Math.max(0, Math.min(idx, sources.length - 1));
  const cur     = sources[safeIdx];
  const multi   = sources.length > 1;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
        WebkitTapHighlightColor: "transparent",
      }}
      onClick={onClose}
    >
      {/* ← Prev */}
      {multi && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx((safeIdx - 1 + sources.length) % sources.length); }}
          style={{
            position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
            width: 44, height: 44, borderRadius: 22,
            border: "0.5px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.45)", color: "#fff",
            fontSize: 22, cursor: "pointer", fontFamily: "inherit",
          }}
        >‹</button>
      )}

      <img
        src={cur?.data}
        alt={cur?.name || ""}
        style={{ maxWidth: "92vw", maxHeight: "82vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
      />

      {/* → Next */}
      {multi && (
        <button
          onClick={(e) => { e.stopPropagation(); setIdx((safeIdx + 1) % sources.length); }}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            width: 44, height: 44, borderRadius: 22,
            border: "0.5px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.45)", color: "#fff",
            fontSize: 22, cursor: "pointer", fontFamily: "inherit",
          }}
        >›</button>
      )}

      {/* ✕ Close */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 16,
          width: 40, height: 40, borderRadius: 20,
          border: "0.5px solid rgba(255,255,255,0.25)",
          background: "rgba(0,0,0,0.45)", color: "#fff",
          fontSize: 16, cursor: "pointer", fontFamily: "inherit",
        }}
      >✕</button>

      {/* Counter */}
      {multi && (
        <div style={{
          position: "absolute", bottom: 18, left: 0, right: 0,
          textAlign: "center", color: "rgba(255,255,255,0.7)",
          fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
        }}>
          {safeIdx + 1} / {sources.length}
        </div>
      )}
    </div>
  );
}
