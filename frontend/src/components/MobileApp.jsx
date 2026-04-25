import { useState, useEffect, useMemo, useCallback } from "react";
import { TEAMS, TEAM_COLORS } from "../App";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Helpers ────────────────────────────────────────────────────────────
function getTeam(sale) {
  for (const [t, s] of Object.entries(TEAMS)) if (s.includes(sale)) return t;
  return "Office";
}
function fmtVal(v) {
  if (!v) return "—";
  if (v >= 1000000) return `฿${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `฿${(v / 1000).toFixed(0)}K`;
  return `฿${Math.round(v).toLocaleString()}`;
}

// แสดงราคาแบบตรงตัว ไม่ปัด K/M — ใช้ใน BR list และ item detail
function fmtFull(v) {
  if (!v) return "—";
  return `฿${Number(v).toLocaleString()}`;
}

// ── Icons ──────────────────────────────────────────────────────────────
function Icon({ name, size = 20, color = "currentColor" }) {
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

// ── Donut ──────────────────────────────────────────────────────────────
function Donut({ bl, wa, no, size = 110, stroke = 12 }) {
  const total = bl + wa + no || 1;
  const r = (size - stroke) / 2 - 2, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const arc = (val, off) => ({ strokeDasharray: `${(val / total) * circ} ${circ}`, strokeDashoffset: -(off / total) * circ });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      {no > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#97C459" strokeWidth={stroke} {...arc(no, bl + wa)} strokeLinecap="round" />}
      {wa > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EF9F27" strokeWidth={stroke} {...arc(wa, bl)} strokeLinecap="round" />}
      {bl > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E24B4A" strokeWidth={stroke} {...arc(bl, 0)} strokeLinecap="round" />}
    </svg>
  );
}

// ── StatusPill ─────────────────────────────────────────────────────────
function StatusPill({ status, size = "sm" }) {
  const sz = size === "xs" ? { px: 6, py: 1, fs: 9, dot: 5 } : { px: 8, py: 2, fs: 10, dot: 5 };
  const map = {
    BLOCK:   { bg: "#3D1212", fg: "#F09595", bd: "#7A2020", dot: "#E24B4A" },
    WARNING: { bg: "#3D2A00", fg: "#FAC775", bd: "#7A5500", dot: "#EF9F27" },
    NORMAL:  { bg: "#1A2E0A", fg: "#C0DD97", bd: "#3A6014", dot: "#639922" },
  };
  const s = map[status] || map.NORMAL;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: s.bg, color: s.fg, border: `0.5px solid ${s.bd}`, borderRadius: 5, padding: `${sz.py}px ${sz.px}px`, fontSize: sz.fs, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: sz.dot, height: sz.dot, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ── TeamPill ───────────────────────────────────────────────────────────
function TeamPill({ team, size = "sm" }) {
  const c = TEAM_COLORS[team] || "#888";
  return <span style={{ display: "inline-block", fontSize: size === "xs" ? 9 : 10, fontWeight: 500, color: c, background: c + "22", border: `0.5px solid ${c}44`, borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>{team}</span>;
}

// ── BottomSheet ────────────────────────────────────────────────────────
function BottomSheet({ open, onClose, children, title, height = "85%", dark = true }) {
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
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>{children}</div>
      </div>
    </>
  );
}

// ── SALE PICKER ────────────────────────────────────────────────────────
function SalePicker({ onSelect, dark, setDark, lang, setLang }) {
  const [selected, setSelected] = useState("");
  const bg = dark ? "#0a0a0a" : "#f5f5f3";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";

  return (
    <div style={{ flex: 1, background: bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Scrollable area */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {/* Header */}
        <div style={{ padding: "32px 24px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>
            <span style={{ color: "#D4357A" }}>Neo</span><span style={{ color: text }}>Biotech</span>
          </div>
          <div style={{ fontSize: 12, color: "#D4357A", fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>BORROW SYSTEM</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: text, marginBottom: 4 }}>{lang === "th" ? "เลือกชื่อ Sale ของคุณ" : "Select your Sale name"}</div>
          <div style={{ fontSize: 12, color: sub }}>{lang === "th" ? "เพื่อดูข้อมูลของคุณเท่านั้น" : "To view only your data"}</div>
        </div>

        {/* Sale list */}
        <div style={{ padding: "0 16px 16px" }}>
          {Object.entries(TEAMS).map(([team, sales]) => (
            <div key={team} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: TEAM_COLORS[team] || "#888", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, paddingLeft: 4 }}>{team} Team</div>
              <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden" }}>
                {sales.map((sale, i) => (
                  <div key={sale} onClick={() => setSelected(sale)} style={{ padding: "13px 16px", borderBottom: i < sales.length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between", background: selected === sale ? (dark ? "#2D0F1A" : "#FBE8F1") : "transparent", cursor: "pointer", userSelect: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: (TEAM_COLORS[team] || "#888") + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: TEAM_COLORS[team] || "#888" }}>
                        {sale.slice(0, 2)}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: selected === sale ? "#D4357A" : text }}>{sale}</span>
                    </div>
                    {selected === sale && <span style={{ color: "#D4357A", fontSize: 16 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer — fixed ไม่ขยับ ไม่ว่าจะ scroll ไปไหน */}
      <div style={{ flexShrink: 0, padding: "14px 16px", background: bg, borderTop: `0.5px solid ${bdr}` }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", background: dark ? "#1a1a1a" : "#e8e8e4", borderRadius: 8, padding: 2, gap: 2 }}>
            {["th", "en"].map(l => <button key={l} onClick={() => setLang(l)} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: lang === l ? "#D4357A" : "transparent", color: lang === l ? "#fff" : sub }}>{l.toUpperCase()}</button>)}
          </div>
          <div onClick={() => setDark(d => !d)} style={{ width: 44, height: 26, borderRadius: 28, background: dark ? "#D4357A" : "rgba(0,0,0,0.12)", position: "relative", cursor: "pointer", transition: "background .25s", flexShrink: 0, display: "flex", alignItems: "center" }}>
            <div style={{ position: "absolute", top: 3, left: dark ? 20 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left .22s cubic-bezier(.4,0,.2,1)" }} />
            <span style={{ position: "absolute", left: 6, fontSize: 10, opacity: dark ? 1 : 0 }}>🌙</span>
            <span style={{ position: "absolute", right: 5, fontSize: 10, opacity: dark ? 0 : 1 }}>☀️</span>
          </div>
        </div>
        <button
          onClick={() => selected && onSelect(selected)}
          style={{ width: "100%", padding: "15px", borderRadius: 13, fontSize: 15, fontWeight: 700, border: "none", cursor: selected ? "pointer" : "not-allowed", background: selected ? "#D4357A" : "#333", color: selected ? "#fff" : "#666", transition: "all .2s" }}
        >
          {selected ? (lang === "th" ? `เข้าใช้งานเป็น ${selected}` : `Continue as ${selected}`) : (lang === "th" ? "กรุณาเลือก Sale" : "Select a sale")}
        </button>
      </div>
    </div>
  );
}

// ── HOME SCREEN ────────────────────────────────────────────────────────
function HomeScreen({ customers, analytics, custValues, syncLogs, lang, setTab, setSelectedCustomer, refreshing, onRefresh, dark, selectedSale }) {
  const bl = customers.filter(c => c.status === "BLOCK").length;
  const wa = customers.filter(c => c.status === "WARNING").length;
  const no = customers.filter(c => c.status === "NORMAL").length;
  const totalBR = customers.reduce((s, c) => s + c.active_br_count, 0);
  const totalVal = customers.reduce((s, c) => s + (custValues[c.cust_code] || 0), 0);
  const criticals = [...customers].filter(c => c.status === "BLOCK").sort((a, b) => b.max_days - a.max_days).slice(0, 3);
  const lastSync = syncLogs[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? (lang === "th" ? "อรุณสวัสดิ์" : "Good morning") : hour < 17 ? (lang === "th" ? "สวัสดีตอนบ่าย" : "Good afternoon") : (lang === "th" ? "สวัสดีตอนเย็น" : "Good evening");
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  return (
    <div style={{ padding: "0 16px 24px", color: text }}>
      {/* Greeting */}
      <div style={{ paddingTop: 6, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: sub, marginBottom: 3, fontWeight: 500 }}>{greet}</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: text }}>{lang === "th" ? "คุณ " : ""}<span style={{ color: "#D4357A" }}>{selectedSale}</span> <span style={{ color: "#D4357A" }}>·</span></div>
        <div style={{ fontSize: 11, color: sub, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#639922", display: "inline-block" }} />
          {lang === "th" ? "ออนไลน์" : "Online"} · {lastSync ? (lang === "th" ? "ซิงค์ล่าสุด" : "Last sync") + " " + new Date(lastSync.synced_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—"}
        </div>
      </div>

      {/* Alert card */}
      {bl > 0 && (
        <div onClick={() => setTab("alerts")} style={{ background: "linear-gradient(135deg, #2D1010 0%, #1e0808 100%)", border: "1px solid #7A2020", borderRadius: 14, padding: "14px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: "#E24B4A", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="alertTri" size={20} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#F09595", fontWeight: 600, marginBottom: 2 }}>{lang === "th" ? "ต้องติดตามทันที" : "Immediate follow-up"}</div>
            <div style={{ fontSize: 14, color: "#F09595", fontWeight: 600 }}>{lang === "th" ? "มี" : "You have"} <span style={{ fontSize: 17 }}>{bl}</span> {lang === "th" ? "ลูกค้า BLOCK" : "BLOCK customers"}</div>
          </div>
          <Icon name="chevron" size={18} color="#F09595" />
        </div>
      )}

      {/* KPI */}
      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>{lang === "th" ? "ภาพรวมวันนี้" : "Today's Overview"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          [lang === "th" ? "ลูกค้าทั้งหมด" : "Total Customers", customers.length, null],
          ["BR Active", totalBR.toLocaleString(), null],
          [lang === "th" ? "มูลค่าค้างรวม" : "Outstanding", fmtVal(totalVal), "block"],
          [lang === "th" ? "วิกฤต (BLOCK)" : "Critical (BLOCK)", bl, "block"],
        ].map(([label, value, accent], i) => {
          const a = accent === "block" ? { bg: dark ? "#2D1010" : "#FCEBEB", bd: dark ? "#7A2020" : "#F09595", fg: dark ? "#F09595" : "#A32D2D" } : null;
          return (
            <div key={i} style={{ background: a ? a.bg : card, border: `1px solid ${a ? a.bd : bdr}`, borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: a ? a.fg : sub, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
              <div style={{ fontSize: i === 2 ? 18 : 22, fontWeight: 700, color: a ? a.fg : text, letterSpacing: -0.5 }}>{value}</div>
            </div>
          );
        })}
      </div>

      {/* Donut */}
      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: text, marginBottom: 10 }}>{lang === "th" ? "สัดส่วนสถานะ" : "Status Breakdown"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", width: 110, height: 110, flexShrink: 0 }}>
            <Donut bl={bl} wa={wa} no={no} size={110} stroke={12} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: text, lineHeight: 1 }}>{customers.length}</div>
              <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>total</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {[["BLOCK", bl, "#E24B4A"], ["WARNING", wa, "#EF9F27"], ["NORMAL", no, "#639922"]].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: sub, flex: 1 }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: text }}>{v}</span>
                <span style={{ fontSize: 10, color: dark ? "#555" : "#999", width: 32, textAlign: "right" }}>{Math.round(v / customers.length * 100) || 0}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Critical preview */}
      {criticals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: text }}>{lang === "th" ? "ลูกค้าวิกฤต" : "Critical Customers"}</div>
            <button onClick={() => setTab("alerts")} style={{ border: "none", background: "transparent", color: "#D4357A", fontSize: 11, fontWeight: 600, padding: 4, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}>
              {lang === "th" ? "ดูทั้งหมด" : "View all"} <Icon name="chevron" size={12} color="#D4357A" />
            </button>
          </div>
          <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 14, overflow: "hidden" }}>
            {criticals.map((c, i) => (
              <div key={c.cust_code} onClick={() => setSelectedCustomer(c)} style={{ padding: "12px 14px", borderBottom: i < criticals.length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: dark ? "#2D1010" : "#FDF0F0", color: dark ? "#F09595" : "#A32D2D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                  {c.customer_name.slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name}</div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>{c.cust_code}</span>·
                    <TeamPill team={c.team} size="xs" />·
                    <span>{c.sale}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: dark ? "#F09595" : "#A32D2D" }}>{c.max_days}<span style={{ fontSize: 9, fontWeight: 500, marginLeft: 2, color: sub }}>{lang === "th" ? "วัน" : "d"}</span></div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>{fmtVal(custValues[c.cust_code])}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>Quick Actions</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["refresh", lang === "th" ? "รีเฟรช" : "Refresh", "#D4357A", onRefresh],
          ["bell", lang === "th" ? "แจ้งเตือน" : "Alerts", "#EF9F27", () => setTab("alerts")],
          ["users", lang === "th" ? "ลูกค้า" : "Customers", "#378ADD", () => setTab("customers")],
          ["trend", lang === "th" ? "สถานะ" : "Status", "#7F77DD", () => setTab("customers")],
        ].map(([icon, label, col, action], i) => (
          <div key={i} onClick={action} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: col + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={icon} size={16} color={col} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: text }}>{refreshing && icon === "refresh" ? (lang === "th" ? "กำลังโหลด..." : "Loading...") : label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CUSTOMERS SCREEN ───────────────────────────────────────────────────
function CustomersScreen({ customers, custValues, lang, setSelectedCustomer, dark }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("days");
  const [filterOpen, setFilterOpen] = useState(false);
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const filtered = useMemo(() => {
    let list = customers.filter(c =>
      (!search || c.customer_name.toLowerCase().includes(search.toLowerCase()) || c.cust_code.toLowerCase().includes(search.toLowerCase())) &&
      (!statusFilter || c.status === statusFilter)
    );
    if (sort === "days") list.sort((a, b) => b.max_days - a.max_days);
    else if (sort === "value") list.sort((a, b) => (custValues[b.cust_code] || 0) - (custValues[a.cust_code] || 0));
    else list.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
    return list;
  }, [customers, search, statusFilter, sort, custValues]);

  return (
    <div style={{ color: text, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative", background: card, border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
            <Icon name="search" size={16} color={sub} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === "th" ? "ค้นหาลูกค้า..." : "Search customer..."} style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "10px 8px", fontSize: 13, color: text }} />
            {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", color: sub, cursor: "pointer", padding: 4 }}><Icon name="close" size={14} color={sub} /></button>}
          </div>
          <button onClick={() => setFilterOpen(true)} style={{ width: 40, height: 40, borderRadius: 10, border: `0.5px solid ${statusFilter ? "#D4357A" : bdr}`, background: statusFilter ? (dark ? "#2D0F1A" : "#FBE8F1") : card, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="filter" size={16} color={statusFilter ? "#D4357A" : sub} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
          {[["", lang === "th" ? "ทั้งหมด" : "All"], ["BLOCK", "BLOCK"], ["WARNING", "WARNING"], ["NORMAL", "NORMAL"]].map(([v, l]) => {
            const active = statusFilter === v;
            const col = v === "BLOCK" ? "#E24B4A" : v === "WARNING" ? "#EF9F27" : v === "NORMAL" ? "#639922" : "#D4357A";
            return <button key={v} onClick={() => setStatusFilter(v)} style={{ padding: "6px 13px", fontSize: 11, fontWeight: 600, borderRadius: 16, flexShrink: 0, border: `1px solid ${active ? col : "rgba(0,0,0,0.1)"}`, background: active ? col : card, color: active ? "#fff" : sub, cursor: "pointer" }}>{l}</button>;
          })}
        </div>
        <div style={{ fontSize: 10, color: sub, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
          <span>{filtered.length} {lang === "th" ? "รายการ" : "results"}</span>
          <span>{lang === "th" ? "เรียงโดย" : "Sort"}: <span style={{ color: "#D4357A", fontWeight: 600 }}>{sort === "days" ? (lang === "th" ? "วันค้าง" : "Days") : sort === "value" ? (lang === "th" ? "มูลค่า" : "Value") : (lang === "th" ? "ชื่อ" : "Name")}</span></span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
        {filtered.map(c => {
          const val = custValues[c.cust_code];
          const rowBg = c.status === "BLOCK" ? (dark ? "#1A0A0A" : "#FEF5F5") : c.status === "WARNING" ? (dark ? "#1A1400" : "#FEFAEE") : card;
          const daysColor = c.max_days > 180 ? (dark ? "#F09595" : "#A32D2D") : c.max_days > 90 ? (dark ? "#FAC775" : "#854F0B") : text;
          return (
            <div key={c.cust_code} onClick={() => setSelectedCustomer(c)} style={{ background: rowBg, border: `0.5px solid ${bdr}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, flexShrink: 0, background: c.status === "BLOCK" ? "#3D1212" : c.status === "WARNING" ? "#3D2A00" : "#1A2E0A", color: c.status === "NORMAL" ? "#C0DD97" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>
                {c.customer_name.slice(0, 2)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name}</div>
                <div style={{ fontSize: 10, color: sub, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace,monospace" }}>{c.cust_code}</span>·
                  <TeamPill team={c.team} size="xs" />·
                  <span>{c.sale}</span>·
                  <span>{c.active_br_count} BR</span>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <StatusPill status={c.status} size="xs" />
                <div style={{ fontSize: 13, fontWeight: 700, color: daysColor }}>{c.max_days}<span style={{ fontSize: 9, fontWeight: 500, marginLeft: 2, color: sub }}>{lang === "th" ? "วัน" : "d"}</span></div>
                <div style={{ fontSize: 10, color: sub }}>{fmtVal(val)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title={lang === "th" ? "ตัวกรอง" : "Filter"} height="55%" dark={dark}>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: sub, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{lang === "th" ? "เรียงโดย" : "Sort by"}</div>
          {[["days", lang === "th" ? "วันค้างมากสุด" : "Most days overdue"], ["value", lang === "th" ? "มูลค่าสูงสุด" : "Highest value"], ["name", lang === "th" ? "ชื่อ (A-Z)" : "Name (A-Z)"]].map(([v, l]) => (
            <div key={v} onClick={() => setSort(v)} style={{ padding: "12px 14px", borderRadius: 10, background: sort === v ? (dark ? "#2D0F1A" : "#FBE8F1") : "transparent", border: `0.5px solid ${sort === v ? "#D4357A" : bdr}`, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 13, color: sort === v ? "#D4357A" : text, fontWeight: sort === v ? 600 : 500 }}>{l}</span>
              {sort === v && <Icon name="check" size={16} color="#D4357A" />}
            </div>
          ))}
          <button onClick={() => setFilterOpen(false)} style={{ width: "100%", padding: "13px", borderRadius: 11, fontSize: 13, fontWeight: 600, border: "none", background: "#D4357A", color: "#fff", cursor: "pointer", marginTop: 12 }}>
            {lang === "th" ? "ตกลง" : "Apply"}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

// ── ALERTS SCREEN ──────────────────────────────────────────────────────
function AlertsScreen({ customers, custValues, lang, setSelectedCustomer, dark }) {
  const [tab, setTab] = useState("BLOCK");
  const blocks = customers.filter(c => c.status === "BLOCK").sort((a, b) => b.max_days - a.max_days);
  const warns = customers.filter(c => c.status === "WARNING").sort((a, b) => b.max_days - a.max_days);
  const list = tab === "BLOCK" ? blocks : warns;
  const col = tab === "BLOCK" ? "#E24B4A" : "#EF9F27";
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  return (
    <div style={{ color: text, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 16px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: 3, gap: 3 }}>
          {[["BLOCK", blocks.length, "#E24B4A"], ["WARNING", warns.length, "#EF9F27"]].map(([k, n, c]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "9px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 8, background: tab === k ? c : "transparent", color: tab === k ? "#fff" : sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {k} <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: tab === k ? "rgba(255,255,255,0.25)" : (dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"), color: tab === k ? "#fff" : sub, fontWeight: 700 }}>{n}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: tab === "BLOCK" ? (dark ? "#2D1010" : "#FCEBEB") : (dark ? "#2D1E00" : "#FAEEDA"), border: `0.5px solid ${tab === "BLOCK" ? (dark ? "#7A2020" : "#F09595") : (dark ? "#7A5500" : "#FAC775")}`, fontSize: 11, color: tab === "BLOCK" ? (dark ? "#F09595" : "#791F1F") : (dark ? "#FAC775" : "#854F0B"), display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Icon name="alertTri" size={14} color={tab === "BLOCK" ? (dark ? "#F09595" : "#A32D2D") : (dark ? "#FAC775" : "#854F0B")} />
          <div><b>{lang === "th" ? (tab === "BLOCK" ? "ต้องติดตามทันที" : "ใกล้ถึงกำหนด") : (tab === "BLOCK" ? "Immediate follow-up" : "Approaching deadline")}:</b> {lang === "th" ? (tab === "BLOCK" ? "ค้างเกิน 180 วัน" : "ค้าง 90-180 วัน") : (tab === "BLOCK" ? "Overdue > 180 days" : "Overdue 90-180 days")}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
        {list.map((c, idx) => (
          <div key={c.cust_code} onClick={() => setSelectedCustomer(c)} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: 0, marginBottom: 9, overflow: "hidden", position: "relative", cursor: "pointer" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: col }} />
            <div style={{ padding: "13px 14px 13px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: col + "33", color: col, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                    <div style={{ fontSize: 14, fontWeight: 600, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{c.customer_name}</div>
                  </div>
                  <div style={{ fontSize: 10, color: sub, display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>{c.cust_code}</span>·
                    <TeamPill team={c.team} size="xs" />·
                    <span>{c.sale}</span>·
                    <span>{c.active_br_count} BR</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: col, lineHeight: 1 }}>{c.max_days}</div>
                  <div style={{ fontSize: 9, color: sub, marginTop: 2 }}>{lang === "th" ? "วัน" : "days"}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: text, background: dark ? "#222" : "#f5f5f3", padding: "4px 9px", borderRadius: 6 }}>{fmtVal(custValues[c.cust_code])}</div>
                <button onClick={e => { e.stopPropagation(); setSelectedCustomer(c); }} style={{ padding: "0 12px", height: 32, borderRadius: 8, border: "none", background: "#D4357A", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                  {lang === "th" ? "ดูรายละเอียด" : "View detail"} <Icon name="chevron" size={12} color="#fff" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PROFILE SCREEN ─────────────────────────────────────────────────────
function ProfileScreen({ dark, setDark, lang, setLang, selectedSale, onChangeSale, syncLogs, customers }) {
  const myCusts = customers.filter(c => c.sale === selectedSale);
  const bl = myCusts.filter(c => c.status === "BLOCK").length;
  const wa = myCusts.filter(c => c.status === "WARNING").length;
  const lastSync = syncLogs[0];
  const myTeam = getTeam(selectedSale);
  const bg = dark ? "#0a0a0a" : "#f5f5f3";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";

  function Row({ icon, color, label, children, isLast }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: isLast ? "none" : `0.5px solid ${bdr}` }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={16} color={color} />
        </div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: text }}>{label}</div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 32px", background: bg, minHeight: "100%" }}>
      {/* Profile card */}
      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 14, padding: "18px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 58, height: 58, borderRadius: 16, flexShrink: 0, background: "linear-gradient(135deg, #D4357A, #9A1A56)", color: "#fff", fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {selectedSale.slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: text, letterSpacing: -0.3 }}>{selectedSale}</div>
          <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>Sales Representative</div>
          <div style={{ marginTop: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 500, color: TEAM_COLORS[myTeam] || "#888", background: (TEAM_COLORS[myTeam] || "#888") + "22", border: `0.5px solid ${(TEAM_COLORS[myTeam] || "#888")}44`, borderRadius: 4, padding: "2px 8px" }}>{myTeam} Team</span>
          </div>
        </div>
      </div>

      {/* Change Sale */}
      <button onClick={onChangeSale} style={{ width: "100%", padding: "13px 16px", borderRadius: 12, border: `0.5px solid ${bdr}`, background: card, color: "#D4357A", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Icon name="refresh" size={14} color="#D4357A" />
        {lang === "th" ? "เปลี่ยน Sale" : "Change Sale"}
      </button>

      {/* Settings */}
      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>{lang === "th" ? "การตั้งค่า" : "Settings"}</div>
      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 16 }}>
        <Row icon="moon" color="#7F77DD" label={lang === "th" ? "โหมดมืด" : "Dark Mode"}>
          <div onClick={() => setDark(d => !d)} style={{ width: 44, height: 26, borderRadius: 28, background: dark ? "#D4357A" : "rgba(0,0,0,0.12)", position: "relative", cursor: "pointer", transition: "background .25s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: dark ? 20 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left .22s cubic-bezier(.4,0,.2,1)" }} />
          </div>
        </Row>
        <Row icon="globe" color="#378ADD" label={lang === "th" ? "ภาษา" : "Language"} isLast>
          <div style={{ display: "flex", background: dark ? "#2a2a2a" : "#f0f0ec", borderRadius: 8, padding: 2, gap: 2 }}>
            {["th", "en"].map(l => <button key={l} onClick={() => setLang(l)} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: lang === l ? "#D4357A" : "transparent", color: lang === l ? "#fff" : sub }}>{l.toUpperCase()}</button>)}
          </div>
        </Row>
      </div>

      {/* My stats */}
      <div style={{ fontSize: 11, fontWeight: 600, color: sub, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>{lang === "th" ? "สถานะของฉัน" : "My Summary"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          [lang === "th" ? "ลูกค้าทั้งหมด" : "My Customers", myCusts.length, null],
          [lang === "th" ? "ต้องติดตาม" : "Need Follow-up", bl + wa, "risk"],
          ["BLOCK", bl, "block"],
          ["WARNING", wa, "warn"],
        ].map(([l, v, acc], i) => {
          const a = acc === "block" ? { bg: dark ? "#2D1010" : "#FCEBEB", fg: dark ? "#F09595" : "#A32D2D", bd: dark ? "#7A2020" : "#F09595" }
            : acc === "warn" ? { bg: dark ? "#2D1E00" : "#FAEEDA", fg: dark ? "#FAC775" : "#854F0B", bd: dark ? "#7A5500" : "#FAC775" }
              : acc === "risk" ? { bg: dark ? "#1e0a00" : "#FFF3E0", fg: dark ? "#FAC775" : "#D97706", bd: dark ? "#5A3000" : "#FDD" } : null;
          return <div key={i} style={{ padding: "12px 14px", borderRadius: 12, background: a ? a.bg : card, border: `1px solid ${a ? a.bd : bdr}` }}>
            <div style={{ fontSize: 10, color: a ? a.fg : sub, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: a ? a.fg : text }}>{v}</div>
          </div>;
        })}
      </div>

      {/* Sync info */}
      <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: "14px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: text, marginBottom: 10 }}>Sync Info</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: sub, marginBottom: 6 }}>
          <span>{lang === "th" ? "ซิงค์ล่าสุด" : "Last sync"}</span>
          <span style={{ color: text, fontWeight: 500 }}>{lastSync ? new Date(lastSync.synced_at).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: sub }}>
          <span>{lang === "th" ? "อัปเดตทุก" : "Updates every"}</span>
          <span style={{ color: "#639922", fontWeight: 600 }}>{lang === "th" ? "25 นาที" : "25 minutes"}</span>
        </div>
      </div>
    </div>
  );
}

// ── CUSTOMER DETAIL SHEET ──────────────────────────────────────────────
function CustomerDetailSheet({ customer, onClose, custValues, lang, dark }) {
  const [brs, setBrs] = useState([]);
  const [loadingBrs, setLoadingBrs] = useState(false);
  const [brSearch, setBrSearch] = useState("");
  const [selectedBR, setSelectedBR] = useState(null);
  const [selectedBRs, setSelectedBRs] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const card = dark ? "#141414" : "#fff";

  useEffect(() => {
    if (!customer) return;
    setLoadingBrs(true); setBrs([]); setBrSearch(""); setSelectedBRs(new Set());
    fetch(`${API_BASE}/customers/${customer.cust_code}/brs`)
      .then(r => r.json()).then(d => setBrs(Array.isArray(d) ? d : [])).catch(() => setBrs([])).finally(() => setLoadingBrs(false));
  }, [customer]);

  const filteredBRs = brs.filter(br => !brSearch || br.borrow_no.toLowerCase().includes(brSearch.toLowerCase()));
  const val = custValues[customer?.cust_code];

  const allSelected  = filteredBRs.length > 0 && filteredBRs.every(br => selectedBRs.has(br.borrow_no));
  const someSelected = filteredBRs.some(br => selectedBRs.has(br.borrow_no));

  const toggleBR = (bno) => setSelectedBRs(prev => {
    const next = new Set(prev);
    next.has(bno) ? next.delete(bno) : next.add(bno);
    return next;
  });

  const toggleAll = () => {
    if (allSelected) {
      setSelectedBRs(prev => { const n = new Set(prev); filteredBRs.forEach(br => n.delete(br.borrow_no)); return n; });
    } else {
      setSelectedBRs(prev => { const n = new Set(prev); filteredBRs.forEach(br => n.add(br.borrow_no)); return n; });
    }
  };

  const handleBulkExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/export-pdf/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrow_nos: [...selectedBRs],
          cust_code: customer?.cust_code || "",
          customer_name: customer?.customer_name || ""
        })
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${customer?.customer_name || "customer"}(${customer?.cust_code || ""})_All BR.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export ไม่สำเร็จ: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  /* ── Export Loading Overlay ── */
  const ExportOverlay = exporting ? (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: dark ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.82)",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 20,
    }}>
      {/* PDF icon */}
      <div style={{ fontSize: 40, lineHeight: 1 }}>📄</div>

      {/* Spinner */}
      <div style={{
        width: 58, height: 58, borderRadius: "50%",
        border: `3.5px solid ${dark ? "#2a0d1a" : "#f0d0dc"}`,
        borderTopColor: "#D4357A",
        animation: "nbspin 0.85s linear infinite",
      }} />

      {/* Text */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: dark ? "#fff" : "#111", marginBottom: 6 }}>
          {lang === "th" ? "กำลัง Export PDF" : "Exporting PDF"}
        </div>
        <div style={{ fontSize: 13, color: dark ? "#888" : "#888" }}>
          {lang === "th" ? "กรุณารอสักครู่..." : "Please wait..."}
        </div>
      </div>

      {/* Count badge */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: dark ? "#2D0F1A" : "#FBE8F1",
        border: "0.5px solid #D4357A55",
        borderRadius: 8, padding: "6px 16px",
        fontSize: 12, fontWeight: 600, color: "#D4357A",
      }}>
        <svg width={13} height={13} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 2L3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5" stroke="#D4357A" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {lang === "th" ? `รวม ${selectedBRs.size} ใบ` : `${selectedBRs.size} files`}
      </div>

      {/* Keyframes via style tag injected once */}
      <style>{`@keyframes nbspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ) : null;

  return (
    <>
      {ExportOverlay}
      <BottomSheet open={!!customer} onClose={onClose} height="92%" dark={dark}>
        {customer && (
          <>
            <div style={{ padding: "4px 20px 14px", borderBottom: `0.5px solid ${bdr}` }}>
              {/* Close button row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: sub }}>{lang === "th" ? "ข้อมูลลูกค้า" : "Customer Detail"}</div>
                <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width={14} height={14} viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke={sub} strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 54, height: 54, borderRadius: 13, flexShrink: 0, background: customer.status === "BLOCK" ? "#3D1212" : customer.status === "WARNING" ? "#3D2A00" : "#1A2E0A", color: customer.status === "NORMAL" ? "#C0DD97" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>
                  {customer.customer_name.slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: text, letterSpacing: -0.3 }}>{customer.customer_name}</div>
                  <div style={{ fontSize: 10, color: sub, marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontFamily: "ui-monospace,monospace", background: dark ? "#1a1a1a" : "#f1f0eb", padding: "1px 6px", borderRadius: 4 }}>{customer.cust_code}</span>
                    <TeamPill team={customer.team} size="xs" />
                    <span>Sale: <b style={{ color: text }}>{customer.sale}</b></span>
                  </div>
                  <div style={{ marginTop: 8 }}><StatusPill status={customer.status} size="sm" /></div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
                {[[lang === "th" ? "วันค้างสูงสุด" : "Max Days", customer.max_days + (lang === "th" ? " วัน" : " d"), customer.status], ["BR Active", customer.active_br_count, null], [lang === "th" ? "มูลค่า" : "Value", fmtVal(val), "block"]].map(([l, v, acc], i) => {
                  const a = acc === "BLOCK" || acc === "block" ? { bg: "#2D1010", fg: "#F09595" } : acc === "WARNING" ? { bg: "#2D1E00", fg: "#FAC775" } : null;
                  return <div key={i} style={{ padding: "8px 10px", borderRadius: 9, background: a ? a.bg : (dark ? "#1a1a1a" : "#f5f5f3"), border: `0.5px solid ${a ? a.fg + "44" : bdr}` }}>
                    <div style={{ fontSize: 9, color: a ? a.fg : sub, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: a ? a.fg : text, marginTop: 2 }}>{v}</div>
                  </div>;
                })}
              </div>
            </div>

            {/* BR search + select toolbar */}
            <div style={{ padding: "10px 20px 6px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: text, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>BR List <span style={{ color: sub, fontWeight: 500, fontSize: 11 }}>({brs.length})</span></span>
                {selectedBRs.size > 0 && (
                  <button onClick={handleBulkExport} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 7, border: "none", background: "#D4357A", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="white"><path d="M2 13h12v1.5H2V13zm6-2L4.5 7.5l1.1-1.1 1.65 1.65V2h1.5v6.05l1.65-1.65L11.5 7.5 8 11z"/></svg>
                    Export ({selectedBRs.size})
                  </button>
                )}
              </div>
              {brs.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div onClick={toggleAll} style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${someSelected ? "#D4357A" : bdr}`, background: allSelected ? "#D4357A" : someSelected ? "#7a1840" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    {allSelected && <svg width="10" height="8" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                    {someSelected && !allSelected && <div style={{ width: 8, height: 8, background: "#D4357A", borderRadius: 1 }} />}
                  </div>
                  <span style={{ fontSize: 12, color: sub }}>เลือกทั้งหมด</span>
                  {selectedBRs.size > 0 && <span style={{ fontSize: 11, color: "#D4357A", fontWeight: 600 }}>{selectedBRs.size} ใบเลือกแล้ว</span>}
                </div>
              )}
              {brs.length > 0 && (
                <div style={{ background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${bdr}`, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 10px" }}>
                  <Icon name="search" size={14} color={sub} />
                  <input value={brSearch} onChange={e => setBrSearch(e.target.value)} placeholder={lang === "th" ? "ค้นหาเลข BR..." : "Search BR..."} style={{ flex: 1, border: "none", background: "transparent", outline: "none", padding: "8px", fontSize: 12, color: text }} />
                </div>
              )}
              {brSearch && <div style={{ fontSize: 10, color: sub, marginTop: 4 }}>พบ <span style={{ color: "#D4357A", fontWeight: 600 }}>{filteredBRs.length}</span> รายการ จาก {brs.length} BR</div>}
            </div>

            {/* BR list */}
            <div style={{ padding: "0 20px 20px" }}>
              {loadingBrs ? <div style={{ padding: "32px", textAlign: "center", fontSize: 12, color: sub }}>{lang === "th" ? "กำลังโหลด BR..." : "Loading BR..."}</div>
                : filteredBRs.length === 0 ? <div style={{ padding: "32px", textAlign: "center", fontSize: 12, color: sub }}>{brSearch ? (lang === "th" ? "ไม่พบ BR ที่ค้นหา" : "No BR found") : (lang === "th" ? "ยังไม่มี BR" : "No BR data")}</div>
                  : filteredBRs.map(br => {
                    const total      = br.items.reduce((s, i) => s + i.price * i.quantity, 0);
                    const daysCol    = br.days_borrowed > 180 ? (dark ? "#F09595" : "#A32D2D") : br.days_borrowed > 90 ? (dark ? "#FAC775" : "#854F0B") : text;
                    const rowBg      = br.borrow_alert === "BLOCK" ? (dark ? "#1A0A0A" : "#FEF5F5") : br.borrow_alert === "WARNING" ? (dark ? "#1A1400" : "#FEFAEE") : card;
                    const isChecked  = selectedBRs.has(br.borrow_no);
                    return (
                      <div key={br.borrow_no} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                        {/* Checkbox */}
                        <div onClick={() => toggleBR(br.borrow_no)} style={{ width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${isChecked ? "#D4357A" : bdr}`, background: isChecked ? "#D4357A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                          {isChecked && <svg width="11" height="9" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                        </div>
                        {/* Row content */}
                        <div onClick={() => setSelectedBR(br)} style={{ flex: 1, background: rowBg, border: `0.5px solid ${isChecked ? "#D4357A88" : bdr}`, borderRadius: 11, padding: "11px 12px", cursor: "pointer" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: text, fontFamily: "ui-monospace,monospace" }}>{br.borrow_no}</span>
                            <StatusPill status={br.borrow_alert} size="xs" />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: sub }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Icon name="calendar" size={11} color={sub} />
                              {br.borrow_date} · <b style={{ color: daysCol, fontWeight: 600 }}>{br.days_borrowed} {lang === "th" ? "วัน" : "d"}</b> · {br.items.length} {lang === "th" ? "รายการ" : "items"}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: text }}>{fmtFull(total)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
            </div>
          </>
        )}
      </BottomSheet>

      {/* BR Detail Sheet */}
      <BottomSheet open={!!selectedBR} onClose={() => setSelectedBR(null)} height="80%" dark={dark}>
        {selectedBR && (() => {
          const total = selectedBR.items.reduce((s, i) => s + i.price * i.quantity, 0);
          return (
            <>
              <div style={{ padding: "4px 20px 14px", borderBottom: `0.5px solid ${bdr}` }}>
                {/* Header row with back + close */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <button onClick={() => setSelectedBR(null)} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "#D4357A", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                    <svg width={16} height={16} viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" stroke="#D4357A" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {lang === "th" ? "← กลับ" : "← Back"}
                  </button>
                  <button onClick={() => setSelectedBR(null)} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <svg width={14} height={14} viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke={sub} strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>
                  </button>
                </div>
                <div style={{ fontSize: 11, color: sub, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "เลขที่ใบยืม" : "Borrow No."}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: text, fontFamily: "ui-monospace,monospace", marginBottom: 8 }}>{selectedBR.borrow_no}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 11, color: sub }}>
                  <span>{selectedBR.borrow_date}</span>·
                  <span style={{ fontWeight: 600, color: selectedBR.days_borrowed > 180 ? (dark ? "#F09595" : "#A32D2D") : selectedBR.days_borrowed > 90 ? (dark ? "#FAC775" : "#854F0B") : text }}>{selectedBR.days_borrowed} {lang === "th" ? "วัน" : "days"}</span>·
                  <StatusPill status={selectedBR.borrow_alert} size="sm" />
                </div>
              </div>
              <div style={{ padding: "12px 20px 20px" }}>
                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{selectedBR.items.length} {lang === "th" ? "รายการสินค้า" : "Items"}</div>
                {selectedBR.items.map((item, i) => (
                  <div key={i} style={{ padding: "12px 0", borderBottom: i < selectedBR.items.length - 1 ? `0.5px solid ${bdr}` : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: sub, fontFamily: "ui-monospace,monospace", marginTop: 1 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: sub, fontFamily: "ui-monospace,monospace", marginBottom: 3 }}>{item.product_code}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: text, lineHeight: 1.35, marginBottom: 6 }}>{item.product_name}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: sub }}>{item.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{item.price.toLocaleString()}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: text }}>฿{(item.price * item.quantity).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 14, padding: "14px", background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมทั้งหมด" : "Grand Total"}</div>
                  <div style={{ fontSize: 18, color: "#D4357A", fontWeight: 700 }}>฿{total.toLocaleString()}</div>
                </div>
                {selectedBR.remark && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: sub, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Remark</div>
                    <div style={{ fontSize: 13, color: text, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${bdr}`, borderRadius: 9, padding: "10px 12px" }}>{selectedBR.remark}</div>
                  </div>
                )}
                <button
                  onClick={() => window.open(`${API_BASE}/brs/${selectedBR.borrow_no}/pdf`, "_blank")}
                  style={{ marginTop: 12, width: "100%", padding: "13px", borderRadius: 11, border: "none", background: "#D4357A", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M2 13h12v1.5H2V13zm6-2L4.5 7.5l1.1-1.1 1.65 1.65V2h1.5v6.05l1.65-1.65L11.5 7.5 8 11z"/></svg>
                  Export PDF
                </button>
              </div>
            </>
          );
        })()}
      </BottomSheet>
    </>
  );
}

// ── SPLASH SCREEN ─────────────────────────────────────────────────────
function SplashScreen({ visible }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0a0a0a",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      opacity: visible ? 1 : 0,
      transition: "opacity 0.45s ease",
      pointerEvents: visible ? "auto" : "none",
    }}>
      {/* Center logo */}
      <div style={{
        width: 88, height: 88, borderRadius: 24,
        background: "linear-gradient(145deg, #D4357A, #9B1D4E)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 10px 40px rgba(212,53,122,0.45)",
        animation: "splashPop 0.5s cubic-bezier(.34,1.56,.64,1) both",
      }}>
        <span style={{
          fontSize: 44, fontWeight: 800, color: "#fff",
          fontFamily: '"IBM Plex Sans Thai","Inter",-apple-system,sans-serif',
          letterSpacing: -2, lineHeight: 1,
        }}>N</span>
      </div>

      {/* Bottom: from NeoBiotech */}
      <div style={{
        position: "absolute", bottom: 52, left: 0, right: 0,
        textAlign: "center",
        animation: "splashFadeUp 0.5s ease 0.15s both",
      }}>
        <div style={{ fontSize: 13, color: "#444", marginBottom: 6,
          fontFamily: '"IBM Plex Sans Thai","Inter",-apple-system,sans-serif' }}>
          from
        </div>
        <div style={{
          fontSize: 16, fontWeight: 700, letterSpacing: -0.4,
          fontFamily: '"IBM Plex Sans Thai","Inter",-apple-system,sans-serif',
        }}>
          <span style={{ color: "#D4357A" }}>Neo</span>
          <span style={{ color: "#555" }}>Biotech</span>
        </div>
      </div>

      {/* Home bar */}
      <div style={{
        position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
        width: 120, height: 4, borderRadius: 99, background: "#222",
      }} />

      <style>{`
        @keyframes splashPop {
          from { opacity: 0; transform: scale(0.72); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes splashFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── MOBILE APP (main export) ───────────────────────────────────────────
export default function MobileApp() {
  const [tab, setTab] = useState("home");
  const [selectedSale, setSelectedSale] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [custValues, setCustValues] = useState({});
  const [syncLogs, setSyncLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("mobile-theme") === "dark");
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "th");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => { localStorage.setItem("mobile-theme", dark ? "dark" : "light"); }, [dark]);

  const load = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    Promise.all([
      fetch(`${API_BASE}/customers`).then(r => r.json()),
      fetch(`${API_BASE}/sync-logs`).then(r => r.json()),
      fetch(`${API_BASE}/analytics/summary`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/analytics/customer-value`).then(r => r.json()).catch(() => ({})),
    ]).then(([custs, logs, anal, cv]) => {
      const cs = Array.isArray(custs) ? custs.map(c => ({ ...c, team: getTeam(c.sale) })) : [];
      setCustomers(cs);
      setSyncLogs(Array.isArray(logs) ? logs : []);
      setAnalytics(anal?.error ? null : anal);
      setCustValues(cv?.error ? {} : cv);
    }).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    // โหลดข้อมูล + แสดง splash อย่างน้อย 1.8 วินาที
    const minDelay = new Promise(res => setTimeout(res, 1800));
    const dataLoad = new Promise(res => {
      Promise.all([
        fetch(`${API_BASE}/customers`).then(r => r.json()),
        fetch(`${API_BASE}/sync-logs`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/summary`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/analytics/customer-value`).then(r => r.json()).catch(() => ({})),
      ]).then(([custs, logs, anal, cv]) => {
        const cs = Array.isArray(custs) ? custs.map(c => ({ ...c, team: getTeam(c.sale) })) : [];
        setCustomers(cs);
        setSyncLogs(Array.isArray(logs) ? logs : []);
        setAnalytics(anal?.error ? null : anal);
        setCustValues(cv?.error ? {} : cv);
        res();
      }).catch(() => res()).finally(() => setLoading(false));
    });
    Promise.all([minDelay, dataLoad]).then(() => setSplashVisible(false));
    const iv = setInterval(() => load(), 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const myCusts = selectedSale ? customers.filter(c => c.sale === selectedSale) : [];

  const tabs = [
    ["home", "home", lang === "th" ? "หน้าหลัก" : "Home"],
    ["customers", "users", lang === "th" ? "ลูกค้า" : "Customers"],
    ["alerts", "bell", lang === "th" ? "แจ้งเตือน" : "Alerts"],
    ["profile", "user", lang === "th" ? "โปรไฟล์" : "Profile"],
  ];

  const phoneBg = dark ? "#0a0a0a" : "#f5f5f3";
  const navBg = dark ? "rgba(17,17,17,0.95)" : "rgba(255,255,255,0.95)";
  const navBdr = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const navText = dark ? "#eee" : "#111";
  const tabBg = dark ? "rgba(17,17,17,0.95)" : "rgba(255,255,255,0.95)";

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: phoneBg, fontFamily: '"Inter", "IBM Plex Sans Thai", -apple-system, sans-serif', WebkitTapHighlightColor: "transparent", overscrollBehavior: "none" }}>
      <SplashScreen visible={splashVisible} />
      {/* ── Navbar ── */}
      {selectedSale && (
        <div style={{ background: navBg, backdropFilter: "blur(12px)", borderBottom: `0.5px solid ${navBdr}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* ปุ่มย้อนกลับ — แสดงเมื่ออยู่หน้าที่ไม่ใช่ home */}
            {tab !== "home" ? (
              <button onClick={() => setTab("home")} style={{ width: 32, height: 32, borderRadius: 8, border: `0.5px solid ${navBdr}`, background: dark ? "#141414" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width={18} height={18} viewBox="0 0 24 24" style={{ display: "block" }}>
                  <path d="M15 6l-6 6 6 6" stroke={dark ? "#eee" : "#111"} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.5, color: navText }}>
                <span style={{ color: "#D4357A" }}>Neo</span>Biotech
              </div>
            )}
            {tab !== "home" && (
              <div style={{ fontSize: 15, fontWeight: 700, color: navText }}>
                {tab === "customers" ? (lang === "th" ? "ลูกค้า" : "Customers")
                 : tab === "alerts"    ? (lang === "th" ? "แจ้งเตือน" : "Alerts")
                 : (lang === "th" ? "โปรไฟล์" : "Profile")}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#D4357A", background: dark ? "#2D0F1A" : "#FBE8F1", border: "0.5px solid #D4357A44", borderRadius: 6, padding: "3px 8px" }}>{selectedSale}</span>
            <button onClick={() => load(true)} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${navBdr}`, background: dark ? "#141414" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: refreshing ? 0.5 : 1 }}>
              <Icon name="refresh" size={13} color={refreshing ? "#D4357A" : "#888"} />
            </button>
          </div>
        </div>
      )}

      {/* ── Screen ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {!selectedSale ? (
          <SalePicker onSelect={s => { setSelectedSale(s); setTab("home"); }} dark={dark} setDark={setDark} lang={lang} setLang={setLang} />
        ) : loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: dark ? "#555" : "#aaa", fontSize: 13 }}>{lang === "th" ? "กำลังโหลดข้อมูล..." : "Loading..."}</div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {tab === "home" ? (
              <HomeScreen customers={myCusts} analytics={analytics} custValues={custValues} syncLogs={syncLogs} lang={lang} setTab={setTab} setSelectedCustomer={setSelectedCustomer} refreshing={refreshing} onRefresh={() => load(true)} dark={dark} selectedSale={selectedSale} />
            ) : tab === "customers" ? (
              <CustomersScreen customers={myCusts} custValues={custValues} lang={lang} setSelectedCustomer={setSelectedCustomer} dark={dark} />
            ) : tab === "alerts" ? (
              <AlertsScreen customers={myCusts} custValues={custValues} lang={lang} setSelectedCustomer={setSelectedCustomer} dark={dark} />
            ) : (
              <ProfileScreen dark={dark} setDark={setDark} lang={lang} setLang={setLang} selectedSale={selectedSale} onChangeSale={() => { setSelectedSale(null); setTab("home"); }} syncLogs={syncLogs} customers={customers} />
            )}
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      {selectedSale && (
        <div style={{ background: tabBg, backdropFilter: "blur(12px)", borderTop: `0.5px solid ${navBdr}`, display: "flex", flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
          {tabs.map(([key, icon, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "10px 0 4px", border: "none", background: "transparent", cursor: "pointer", fontSize: 10, fontWeight: 600, color: tab === key ? "#D4357A" : (dark ? "#555" : "#aaa"), transition: "color 0.15s" }}>
              <Icon name={icon} size={22} color={tab === key ? "#D4357A" : (dark ? "#555" : "#aaa")} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Customer Detail Sheet ── */}
      <CustomerDetailSheet customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} custValues={custValues} lang={lang} dark={dark} />
    </div>
  );
}