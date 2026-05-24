// =============================================================================
// ReturnsScreen.jsx — Production returns list screen for Mobile BR Return
//
// Extracted from MobilePrototypeApp.jsx (lines 2797-3491) with prototype
// scaffolding removed. DateRangePickerSheet (lines 2132-2380) is co-located
// here since it is used only by this screen.
//
// Prototype scaffolding removed:
//   • simulateStatusChange / Admin sim BottomSheet / simReq state
//   • composerReq state / AdminFeedbackComposer component
//   • applyAdminRejection function
//   • deleteRequest function (used loadProtoReturns / saveProtoReturns)
//   • Long-press handlers (startPress / cancelPress / pressTimer)
//   • isTestMode() conditional rendering — replaced with production text
//   • _demo badge on attachment thumbnails
//
// Bug fixed vs prototype:
//   • Date filter used Date.getTime() (ms ≈ 1.7e12) against dateSort
//     (BBBBMMDD ≈ 2.5e7) — values are incompatible scales.
//     Fixed: dateToBuddhistInt() converts selected Date → BBBBMMDD int
//     before comparison with r.dateSort.
//
// Props:
//   lang             {'th'|'en'}
//   dark             {boolean}
//   sale             {string}    Active sale name (used to filter returns)
//   returns          {Array}     Return requests from parent (via loadReturnRequests)
//   refreshReturns   {function}  Triggers parent to re-fetch from backend
//   setReturnsCount  {function}  Passes pending count up to tab badge
// =============================================================================

import { useState, useMemo, useRef, useEffect } from "react";
import { BottomSheet, Icon } from "./shared";
import { STATUS_META, typeLabel, breakdownFor, buildApprovedFullView } from "./constants";
import { ImageLightbox, ReturnStatusPill, RevisionChip } from "./components";
import { RequestReturnSheet } from "./RequestReturnSheet";
import {
  fmtDateTime, fmtShortDate, fmtDayMonth,
  startOfDay, sameDay,
  THAI_MONTHS_SHORT, EN_MONTHS_SHORT,
  THAI_DAY_HEADERS, EN_DAY_HEADERS,
  THAI_DAY_FULL, EN_DAY_FULL,
} from "./helpers";

// ── Date helper ───────────────────────────────────────────────────────────────
// Convert a JS Date to the BBBBMMDD integer used as dateSort in the DB.
// CRITICAL: Date.getTime() (Unix ms ≈ 1.7e12) is NOT compatible with dateSort
// (BBBBMMDD ≈ 2.5e7). Always convert before comparing with r.dateSort.
function dateToBuddhistInt(d) {
  if (!d) return null;
  return (d.getFullYear() + 543) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// ── DateRangePickerSheet ──────────────────────────────────────────────────────
// Calendar-based date range picker. Extracted from MobilePrototypeApp.jsx
// lines 2132-2380. No prototype-only content — kept as-is.
function DateRangePickerSheet({ open, onClose, from, to, onApply, dark, lang }) {
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);
  const scrollRef = useRef(null);
  const currentMonthRef = useRef(null);

  useEffect(() => {
    if (open) {
      setLocalFrom(from);
      setLocalTo(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll to current month on open
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const target = currentMonthRef.current;
      if (!scroller || !target) return;
      try {
        scroller.scrollTo({ top: target.offsetTop - 8, behavior: "auto" });
      } catch {
        try { scroller.scrollTop = target.offsetTop - 8; } catch {}
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  // 11 months back + current + 1 forward
  const months = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = -11; i <= 1; i++) {
      out.push(new Date(now.getFullYear(), now.getMonth() + i, 1));
    }
    return out;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = startOfDay(new Date());
  const currentMonthIdx = months.findIndex(m =>
    m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth()
  );

  function pickDate(d) {
    const day = startOfDay(d);
    if (!localFrom || (localFrom && localTo)) {
      setLocalFrom(day);
      setLocalTo(null);
    } else {
      if (day.getTime() < localFrom.getTime()) {
        setLocalFrom(day);
        setLocalTo(null);
      } else {
        setLocalTo(day);
      }
    }
  }

  function inBetween(d) {
    if (!localFrom || !localTo) return false;
    const t = d.getTime();
    return t > localFrom.getTime() && t < localTo.getTime();
  }

  const dayHeaders   = lang === "th" ? THAI_DAY_HEADERS : EN_DAY_HEADERS;
  const monthsLabels = lang === "th" ? THAI_MONTHS_SHORT : EN_MONTHS_SHORT;
  const daysCount    = (localFrom && localTo)
    ? Math.round((localTo - localFrom) / 86400000) + 1
    : (localFrom ? 1 : 0);

  return (
    <BottomSheet open={open} onClose={onClose} height="92%" dark={dark}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "4px 20px 12px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Icon name="close" size={14} color={sub} />
            </button>
            <div style={{ fontSize: 15, fontWeight: 700, color: text }}>{lang === "th" ? "เลือกวันที่" : "Select date"}</div>
            <button
              onClick={() => { setLocalFrom(null); setLocalTo(null); }}
              disabled={!localFrom && !localTo}
              style={{ fontSize: 12, color: (localFrom || localTo) ? "#D4357A" : sub, background: "transparent", border: "none", cursor: (localFrom || localTo) ? "pointer" : "default", fontWeight: 600, padding: 4, fontFamily: "inherit", opacity: (localFrom || localTo) ? 1 : 0.5 }}
            >
              {lang === "th" ? "ล้าง" : "Clear"}
            </button>
          </div>
          {/* From / To pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, padding: "9px 12px", borderRadius: 10, background: localFrom ? "#2D0F1A" : (dark ? "#1a1a1a" : "#f5f5f3"), border: `1px solid ${localFrom ? "#D4357A" : bdr}` }}>
              <div style={{ fontSize: 9, color: sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{lang === "th" ? "เริ่มต้น" : "From"}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: localFrom ? "#D4357A" : sub, marginTop: 3 }}>
                {localFrom ? fmtDayMonth(localFrom, lang) : (lang === "th" ? "เลือกวัน" : "Select")}
              </div>
            </div>
            <Icon name="chevron" size={14} color={sub} />
            <div style={{ flex: 1, padding: "9px 12px", borderRadius: 10, background: localTo ? "#2D0F1A" : (dark ? "#1a1a1a" : "#f5f5f3"), border: `1px solid ${localTo ? "#D4357A" : bdr}` }}>
              <div style={{ fontSize: 9, color: sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{lang === "th" ? "สิ้นสุด" : "To"}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: localTo ? "#D4357A" : sub, marginTop: 3 }}>
                {localTo ? fmtDayMonth(localTo, lang) : (lang === "th" ? "เลือกวัน" : "Select")}
              </div>
            </div>
          </div>
        </div>

        {/* Day-of-week strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "10px 16px", flexShrink: 0, borderBottom: `0.5px solid ${bdr}`, background: dark ? "#0a0a0a" : "#fafaf8" }}>
          {dayHeaders.map((h, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 10, color: sub, fontWeight: 600, letterSpacing: 0.3 }}>{h}</div>
          ))}
        </div>

        {/* Months */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "8px 16px 20px" }}>
          {months.map((monthDate, mIdx) => {
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const firstDayOfWeek = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const cells = [];
            for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

            return (
              <div key={mIdx} ref={mIdx === currentMonthIdx ? currentMonthRef : null} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: text, textAlign: "center", margin: "12px 0 10px" }}>
                  {monthsLabels[month]} {lang === "th" ? year + 543 : year}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                  {cells.map((d, idx) => {
                    if (!d) return <div key={idx} style={{ height: 44 }} />;
                    const isT     = sameDay(d, today);
                    const isStart = sameDay(d, localFrom);
                    const isEnd   = sameDay(d, localTo);
                    const between = inBetween(d);
                    const hasRange = !!(localFrom && localTo && !sameDay(localFrom, localTo));
                    const showBand = between || (hasRange && (isStart || isEnd));
                    const bandFill = dark ? "rgba(212, 53, 122, 0.16)" : "rgba(212, 53, 122, 0.12)";
                    const bandEdge = dark ? "rgba(212, 53, 122, 0.36)" : "rgba(212, 53, 122, 0.32)";
                    return (
                      <button
                        key={idx}
                        onClick={() => pickDate(d)}
                        style={{ position: "relative", height: 44, padding: 0, border: "none", cursor: "pointer", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
                      >
                        {showBand && (
                          <div
                            aria-hidden
                            style={{
                              position: "absolute", top: 4, bottom: 4,
                              left:  isStart && hasRange ? "50%" : 0,
                              right: isEnd   && hasRange ? "50%" : 0,
                              background: bandFill,
                              borderTop:    `1px solid ${bandEdge}`,
                              borderBottom: `1px solid ${bandEdge}`,
                              borderLeft:  isStart && hasRange ? `1px solid ${bandEdge}` : "none",
                              borderRight: isEnd   && hasRange ? `1px solid ${bandEdge}` : "none",
                              borderTopLeftRadius:     isStart && hasRange ? 999 : 0,
                              borderBottomLeftRadius:  isStart && hasRange ? 999 : 0,
                              borderTopRightRadius:    isEnd   && hasRange ? 999 : 0,
                              borderBottomRightRadius: isEnd   && hasRange ? 999 : 0,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        <div style={{
                          position: "relative", zIndex: 1,
                          width: 36, height: 36, borderRadius: "50%",
                          background: (isStart || isEnd) ? "#D4357A" : "transparent",
                          color: (isStart || isEnd) ? "#fff" : (between ? "#D4357A" : (isT ? "#D4357A" : text)),
                          fontSize: 13,
                          fontWeight: (isStart || isEnd || isT) ? 700 : 500,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: (isT && !isStart && !isEnd && !between) ? `1px solid #D4357A` : "none",
                          boxShadow: (isStart || isEnd) ? "0 2px 8px rgba(212,53,122,0.35)" : "none",
                        }}>
                          {d.getDate()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Apply */}
        <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, flexShrink: 0 }}>
          <button
            onClick={() => { onApply(localFrom, localTo); onClose(); }}
            disabled={!localFrom}
            style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none",
              background: localFrom ? "#D4357A" : "#333",
              color: localFrom ? "#fff" : "#666",
              fontSize: 14, fontWeight: 700,
              cursor: localFrom ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            {!localFrom
              ? (lang === "th" ? "เลือกวันที่" : "Select date")
              : !localTo
                ? (lang === "th" ? `ตกลง (${fmtShortDate(localFrom, lang)})` : `Apply (${fmtShortDate(localFrom, lang)})`)
                : (lang === "th" ? `ตกลง (${daysCount} วัน)` : `Apply (${daysCount} days)`)}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ── ReturnsScreen ─────────────────────────────────────────────────────────────
export function ReturnsScreen({ lang, dark, sale, returns, refreshReturns, setReturnsCount }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo]     = useState(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState(null);
  const [editingReq, setEditingReq]   = useState(null);
  const [lightboxImages, setLightboxImages] = useState(null);
  const [lightboxStart,  setLightboxStart]  = useState(0);
  const [editToast, setEditToast] = useState(null);

  const text = dark ? "#eee" : "#111";
  const sub  = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr  = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  // Show only this Sale's returns (backend sends all; filter client-side)
  const mine = useMemo(() => returns.filter(r =>
    (r.sale || "").toUpperCase() === (sale || "").toUpperCase()
  ), [returns, sale]);

  useEffect(() => {
    if (setReturnsCount) setReturnsCount(mine.filter(r => r.status === "pending").length);
  }, [mine, setReturnsCount]);

  const counts = {
    pending:   mine.filter(r => r.status === "pending").length,
    approved:  mine.filter(r => r.status === "approved").length,
    rejected:  mine.filter(r => r.status === "rejected").length,
    cancelled: mine.filter(r => r.status === "cancelled").length,
  };

  // ── Date filter — BBBBMMDD comparison ─────────────────────────────────────
  // Convert selected Date objects to the same BBBBMMDD integer format that
  // the backend stores in the dateSort column. Direct getTime() comparison
  // would never match (different scales: ms ≈ 1.7e12 vs BBBBMMDD ≈ 2.5e7).
  const fromDs = dateToBuddhistInt(dateFrom);
  const toDs   = dateTo
    ? dateToBuddhistInt(dateTo)
    : (dateFrom ? dateToBuddhistInt(dateFrom) : null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const reqId = (r) => r.requestId || r.id || "";
    return mine
      .filter(r =>
        (!q || reqId(r).toLowerCase().includes(q) ||
               (r.custName || r.cust || "").toLowerCase().includes(q) ||
               (r.brNo || r.br || "").toLowerCase().includes(q)) &&
        (!statusFilter || r.status === statusFilter) &&
        (fromDs == null || (
          (Number(r.dateSort) || 0) >= fromDs &&
          (Number(r.dateSort) || 0) <= toDs
        ))
      )
      .sort((a, b) => (Number(b.dateSort) || 0) - (Number(a.dateSort) || 0));
  }, [mine, search, statusFilter, fromDs, toDs]);

  const hasAnyFilter = !!(search || statusFilter || dateFrom);

  return (
    <div style={{ color: text, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* KPI strip */}
      <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
          {[
            ["pending",   counts.pending,   STATUS_META.pending],
            ["approved",  counts.approved,  STATUS_META.approved],
            ["rejected",  counts.rejected,  STATUS_META.rejected],
            ["cancelled", counts.cancelled, STATUS_META.cancelled],
          ].map(([k, n, m]) => {
            const isActive = statusFilter === k;
            return (
              <button
                key={k}
                onClick={() => setStatusFilter(isActive ? "" : k)}
                style={{
                  background: isActive ? m.bg : card,
                  border: `1px solid ${isActive ? m.color : bdr}`,
                  borderRadius: 10, padding: "10px 6px", textAlign: "center",
                  cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.12s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: isActive ? m.color : (dark ? "#ccc" : "#444"), letterSpacing: 0.3 }}>
                    {lang === "th" ? m.label_short_th : m.label_en}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: isActive ? m.color : text, lineHeight: 1 }}>{n}</div>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
          <Icon name="search" size={14} color={sub} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={lang === "th" ? "ค้นหา RT / ลูกค้า / BR..." : "Search RT / customer / BR..."}
            style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "8px", fontSize: 12, color: text }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", color: sub, cursor: "pointer", padding: 4 }}>
              <Icon name="close" size={12} color={sub} />
            </button>
          )}
        </div>

        {/* Date filter trigger */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <button
            onClick={() => setDateOpen(true)}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              padding: "9px 12px", borderRadius: 10,
              border: `1px solid ${dateFrom ? "#D4357A" : bdr}`,
              background: dateFrom ? "#2D0F1A" : card,
              color: dateFrom ? "#D4357A" : sub,
              fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            }}
          >
            <Icon name="calendar" size={14} color={dateFrom ? "#D4357A" : sub} />
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {!dateFrom
                ? (lang === "th" ? "ทุกวันที่" : "Any date")
                : (dateTo && !sameDay(dateFrom, dateTo))
                  ? `${fmtShortDate(dateFrom, lang)} → ${fmtShortDate(dateTo, lang)}`
                  : fmtShortDate(dateFrom, lang)}
            </span>
            {dateFrom && (
              <span
                onClick={(e) => { e.stopPropagation(); setDateFrom(null); setDateTo(null); }}
                style={{ padding: "0 4px", cursor: "pointer", color: sub, fontSize: 14, lineHeight: 1 }}
              >✕</span>
            )}
          </button>
          {hasAnyFilter && (
            <button
              onClick={() => { setSearch(""); setStatusFilter(""); setDateFrom(null); setDateTo(null); }}
              style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, borderRadius: 10, flexShrink: 0, border: `0.5px dashed rgba(255,255,255,0.15)`, background: "transparent", color: sub, cursor: "pointer" }}
            >
              {lang === "th" ? "ล้างตัวกรอง" : "Clear"}
            </button>
          )}
        </div>

        <div style={{ fontSize: 10, color: sub, marginTop: 8 }}>
          {filtered.length} {lang === "th" ? "รายการ" : "results"}
          {" · "}{lang === "th" ? "Admin ตรวจสอบผ่าน Desktop" : "Admin reviews on Desktop"}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: sub, fontSize: 12, lineHeight: 1.6 }}>
            {mine.length === 0
              ? (lang === "th" ? "ยังไม่มีคำขอคืนสินค้า\nเข้าไปที่ BR Detail แล้วกด ขอคืนสินค้า" : "No return requests yet.\nOpen a BR detail and tap Request Return.")
              : (lang === "th" ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "No matching requests")}
          </div>
        ) : filtered.map(r => {
          const m = STATUS_META[r.status] || STATUS_META.pending;
          const total = Array.isArray(r.submittedItems) ? r.submittedItems.reduce((s, x) =>
            s + (Number(x.totalPrice) || (Number(x.price)||0) * (Number(x.quantity)||0) || 0), 0) : 0;
          const typeSummary = Array.isArray(r.submittedItems)
            ? (() => {
                const set = new Set();
                for (const x of r.submittedItems) {
                  for (const b of breakdownFor(x)) set.add(b.key);
                }
                return [...set].join(", ");
              })()
            : "";

          const revCount = 1 + (Array.isArray(r.revisionHistory) ? r.revisionHistory.length : 0);
          const photoCount = Array.isArray(r.attachments) ? r.attachments.length : 0;
          const rejItemCount = Array.isArray(r.rejectedItems) ? r.rejectedItems.length : 0;
          const rowItemCount =
            (r.status === "approved" && Array.isArray(r.revisionHistory) && r.revisionHistory.length > 0)
              ? buildApprovedFullView(r).length
              : (typeof r.items === "number" ? r.items : (Array.isArray(r.submittedItems) ? r.submittedItems.length : 0));

          const displayId = r.requestId || r.id;

          return (
            <div
              key={displayId}
              onClick={() => setSelectedReq(r)}
              style={{ background: card, border: `0.5px solid ${bdr}`, borderLeft: `3px solid ${m.color}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer", userSelect: "none" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: text }}>{displayId}</div>
                    <RevisionChip rev={revCount} lang={lang} />
                  </div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{fmtDateTime(r.date, lang)}</div>
                </div>
                <ReturnStatusPill status={r.status} size="xs" lang={lang} />
              </div>
              <div style={{ fontSize: 12, color: text, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.custName || r.cust} <span style={{ color: sub }}>·</span> <span style={{ color: sub, fontFamily: "ui-monospace,monospace" }}>{r.brNo || r.br}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                <span style={{ color: sub }}>{rowItemCount} {lang === "th" ? "รายการ" : "items"}{typeSummary ? ` · ${typeSummary}` : ""}</span>
                <span style={{ fontWeight: 700, color: text }}>฿{total.toLocaleString()}</span>
              </div>
              {r.status === "rejected" && (
                <div style={{ marginTop: 7, padding: "7px 9px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 6, fontSize: 10, color: STATUS_META.rejected.color, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 700, marginBottom: r.adminNote ? 2 : 0 }}>
                    ⚠ {lang === "th" ? "ต้องแก้ไข" : "Needs revision"}
                    {rejItemCount > 0 ? ` · ${rejItemCount} ${lang === "th" ? "รายการ" : "item(s)"}` : ""}
                    {photoCount > 0 ? ` · ${photoCount} 📷` : ""}
                  </div>
                  {r.adminNote && (
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.adminNote}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Return detail sheet */}
      <BottomSheet open={!!selectedReq} onClose={() => setSelectedReq(null)} height="86%" dark={dark}>
        {selectedReq && (() => {
          const m = STATUS_META[selectedReq.status] || STATUS_META.pending;
          const revHist = Array.isArray(selectedReq.revisionHistory) ? selectedReq.revisionHistory : [];

          // ── Items-in-scope filter ─────────────────────────────────────────
          // rejected        → only items Admin flagged this round
          // approvedFull    → complete post-correction set (approved + history)
          // corrected       → only items re-touched in most-recent revision
          // all             → full submittedItems as-is
          let displayItems;
          let scopeMode;
          if (selectedReq.status === "rejected") {
            displayItems = (selectedReq.rejectedItems || []).map(r => ({
              item_id: r.itemId || r.item_id,
              line_no: r.lineNo || r.line_no,
              product_code: r.code || r.product_code,
              product_name: r.name || r.product_name,
              price: Number(r.price) || 0,
              quantity: Number(r.quantity) || 0,
              totalPrice: Number(r.totalPrice) || ((Number(r.price)||0) * (Number(r.quantity)||0)),
              retQty:  Number(r.retQty)  || 0,
              clmQty:  Number(r.clmQty)  || 0,
              saleQty: Number(r.saleQty) || 0,
              freeQty: Number(r.freeQty) || 0,
              _rejectReason: r.reason || "",
            }));
            scopeMode = "rejected";
          } else if (selectedReq.status === "approved" && revHist.length > 0) {
            displayItems = buildApprovedFullView(selectedReq);
            scopeMode = "approvedFull";
          } else if (revHist.length > 0) {
            const last = revHist[revHist.length - 1];
            const correctedIds = Array.isArray(last?.correctedItemIds) ? last.correctedItemIds : [];
            if (correctedIds.length > 0) {
              displayItems = (selectedReq.submittedItems || []).filter(si =>
                correctedIds.includes(si.item_id)
                || correctedIds.includes(si.itemId)
                || correctedIds.includes(`${si.product_code || si.code}-${si.line_no || si.lineNo || ""}`)
              );
              scopeMode = "corrected";
            } else {
              displayItems = selectedReq.submittedItems || [];
              scopeMode = "all";
            }
          } else {
            displayItems = selectedReq.submittedItems || [];
            scopeMode = "all";
          }

          const total = displayItems.reduce((s, x) =>
            s + (Number(x.totalPrice) || (Number(x.price)||0) * (Number(x.quantity)||0)), 0);
          const itemsLabel = scopeMode === "rejected"
            ? (lang === "th" ? "รายการที่ต้องแก้ไข" : "Items to revise")
            : scopeMode === "approvedFull"
              ? (lang === "th" ? "รายการที่อนุมัติทั้งหมด" : "All approved items")
              : scopeMode === "corrected"
                ? (lang === "th" ? "รายการที่แก้ไขใหม่" : "Revised items")
                : (lang === "th" ? "รายการ" : "Items");
          const totalLabel = (scopeMode === "all" || scopeMode === "approvedFull")
            ? (lang === "th" ? "รวมทั้งหมด" : "Grand total")
            : (lang === "th" ? "รวมรายการที่แสดง" : "Subtotal (shown)");

          const displayId = selectedReq.requestId || selectedReq.id;

          return (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              {/* Detail header */}
              <div style={{ padding: "4px 20px 14px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: sub }}>{lang === "th" ? "รายละเอียดคำขอ" : "Return detail"}</div>
                  <button onClick={() => setSelectedReq(null)} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <Icon name="close" size={14} color={sub} />
                  </button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เลขที่คำขอ" : "Request ID"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{displayId}</div>
                      <RevisionChip rev={1 + revHist.length} lang={lang} />
                    </div>
                    <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>
                      {fmtDateTime(selectedReq.date, lang)} · <b style={{ color: "#D4357A" }}>{selectedReq.sale}</b>
                    </div>
                    {selectedReq.resubmittedAt && (
                      <div style={{ fontSize: 10, color: "#D4357A", marginTop: 2 }}>
                        ↻ {lang === "th" ? "ส่งแก้ไขเมื่อ" : "Resubmitted"} {fmtDateTime(selectedReq.resubmittedAt, lang)}
                      </div>
                    )}
                  </div>
                  <ReturnStatusPill status={selectedReq.status} size="sm" lang={lang} />
                </div>
              </div>

              {/* Detail body */}
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ลูกค้า / BR" : "Customer / BR"}</div>
                <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedReq.custName || selectedReq.cust}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 2, fontFamily: "ui-monospace,monospace" }}>{selectedReq.custCode}</div>
                    </div>
                  </div>
                  <div style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 10, color: sub }}>BR</div>
                      <div style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", marginTop: 2 }}>{selectedReq.brNo || selectedReq.br}</div>
                    </div>
                  </div>
                </div>

                {/* Rejection banner */}
                {selectedReq.status === "rejected" && (
                  <div style={{
                    background: STATUS_META.rejected.bg,
                    border: `0.5px solid ${STATUS_META.rejected.border}`,
                    borderRadius: 11, padding: "12px 14px", marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: selectedReq.adminNote ? 6 : 0, letterSpacing: 0.3 }}>
                      ⚠ {lang === "th" ? "มีรายการที่ต้องแก้ไข" : "Items need revision"}
                    </div>
                    {selectedReq.adminNote && (
                      <div style={{ fontSize: 12, lineHeight: 1.55, color: "#fff", whiteSpace: "pre-line" }}>
                        <b>{lang === "th" ? "หมายเหตุ Admin: " : "Admin note: "}</b>{selectedReq.adminNote}
                      </div>
                    )}
                  </div>
                )}

                {/* Items label row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: scopeMode === "rejected" ? "#fff" : sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
                    {itemsLabel} ({displayItems.length})
                  </div>
                  {(scopeMode === "rejected" || scopeMode === "corrected" || scopeMode === "approvedFull") && (
                    <span style={{ fontSize: 9, color: sub, fontWeight: 600, letterSpacing: 0.3 }}>
                      {scopeMode === "rejected"
                        ? (lang === "th" ? "ซ่อนรายการที่อนุมัติแล้ว" : "Approved items hidden")
                        : scopeMode === "approvedFull"
                          ? (lang === "th" ? "รวมรายการที่ผ่านการแก้ไขด้วย" : "Includes corrected versions")
                          : (lang === "th" ? "เฉพาะรายการที่แก้ไขรอบล่าสุด" : "Latest-revision items only")}
                    </span>
                  )}
                </div>

                {/* Items list */}
                <div style={{ background: card, border: `0.5px solid ${scopeMode === "rejected" ? STATUS_META.rejected.border : bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
                  {displayItems.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: sub, fontSize: 12 }}>
                      {lang === "th" ? "ไม่มีรายการที่ตรงเงื่อนไข" : "No items in scope"}
                    </div>
                  ) : displayItems.map((si, i) => {
                    const breakdown = breakdownFor(si);
                    const primaryColor = breakdown.length === 1 ? breakdown[0].color : "#D4357A";
                    return (
                      <div key={i} style={{ padding: "11px 14px", borderBottom: i < displayItems.length - 1 ? `0.5px solid ${bdr}` : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: sub, fontFamily: "ui-monospace,monospace" }}>{si.product_code || si.code}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{si.product_name}</div>
                            <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{Number(si.price).toLocaleString()}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: primaryColor }}>฿{(Number(si.totalPrice) || 0).toLocaleString()}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                          {breakdown.map(b => (
                            <span key={b.key} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${b.color}55`, borderRadius: 6, padding: "2px 7px", letterSpacing: 0.3 }}>
                              {b.icon} {b.qty} {typeLabel(b, lang).toUpperCase()}
                            </span>
                          ))}
                        </div>
                        {si._rejectReason && (
                          <div style={{ marginTop: 8, padding: "7px 9px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 6, fontSize: 11, color: "#fff", lineHeight: 1.5 }}>
                            <b>{lang === "th" ? "เหตุผล: " : "Reason: "}</b>{si._rejectReason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Remark */}
                {selectedReq.remark && (
                  <>
                    <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "หมายเหตุ" : "Remark"}</div>
                    <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#ccc" : "#444", whiteSpace: "pre-line", marginBottom: 12 }}>{selectedReq.remark}</div>
                  </>
                )}

                {/* Rejected extras: Admin photos + resubmit CTA */}
                {selectedReq.status === "rejected" && (
                  <div style={{ marginBottom: 14 }}>
                    {Array.isArray(selectedReq.attachments) && selectedReq.attachments.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: STATUS_META.rejected.color, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
                          📷 {lang === "th" ? `หลักฐานจาก Admin (${selectedReq.attachments.length})` : `Admin evidence (${selectedReq.attachments.length})`}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                          {selectedReq.attachments.map((att, i) => (
                            <button
                              key={i}
                              onClick={(e) => { e.stopPropagation(); setLightboxImages(selectedReq.attachments); setLightboxStart(i); }}
                              style={{ border: `0.5px solid ${bdr}`, borderRadius: 9, overflow: "hidden", aspectRatio: "1 / 1", background: dark ? "#0a0a0a" : "#fafaf8", padding: 0, cursor: "pointer" }}
                            >
                              <img src={att.data} alt={att.name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => setEditingReq(selectedReq)}
                      style={{
                        width: "100%", padding: 14, borderRadius: 12, border: "none",
                        background: "linear-gradient(135deg, #D4357A, #9A1A56)",
                        color: "#fff", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "inherit",
                        boxShadow: "0 6px 20px rgba(212,53,122,0.3)",
                        marginTop: 4,
                      }}
                    >
                      ↩ {lang === "th" ? "แก้ไขและส่งใหม่" : "Edit and resubmit"}
                    </button>
                  </div>
                )}

                {/* Cancel reason */}
                {selectedReq.cancelReason && selectedReq.status === "cancelled" && (
                  <>
                    <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เหตุผลที่ยกเลิก" : "Cancel reason"}</div>
                    <div style={{ background: STATUS_META.cancelled.bg, border: `0.5px solid ${STATUS_META.cancelled.border}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#aaa" : "#444", marginBottom: 12 }}>{selectedReq.cancelReason}</div>
                  </>
                )}

                {/* Grand total */}
                <div style={{ padding: 14, background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{totalLabel}</span>
                  <span style={{ fontSize: 17, color: "#D4357A", fontWeight: 700 }}>฿{total.toLocaleString()}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      {/* Date range picker */}
      <DateRangePickerSheet
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        from={dateFrom}
        to={dateTo}
        dark={dark}
        lang={lang}
        onApply={(f, t) => { setDateFrom(f); setDateTo(t); }}
      />

      {/* Edit-and-resubmit sheet */}
      <RequestReturnSheet
        open={!!editingReq}
        onClose={() => setEditingReq(null)}
        editingRequest={editingReq}
        sale={editingReq?.sale}
        lang={lang}
        dark={dark}
        onSubmitted={(updated) => {
          refreshReturns();
          setEditingReq(null);
          if (updated) setSelectedReq(updated);
          setEditToast(lang === "th" ? "ส่งคำขอแก้ไขสำเร็จ" : "Resubmitted successfully");
          setTimeout(() => setEditToast(null), 2200);
        }}
      />

      {/* Image lightbox */}
      <ImageLightbox
        open={Array.isArray(lightboxImages) && lightboxImages.length > 0}
        sources={lightboxImages || []}
        startIndex={lightboxStart}
        onClose={() => setLightboxImages(null)}
      />

      {/* Resubmit success toast */}
      {editToast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 90,
          transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #639922, #3A6014)",
          color: "#fff", fontSize: 13, fontWeight: 700,
          padding: "10px 18px", borderRadius: 999,
          boxShadow: "0 8px 24px rgba(99,153,34,0.4)",
          zIndex: 9998, letterSpacing: 0.3,
        }}>
          ✓ {editToast}
        </div>
      )}
    </div>
  );
}
