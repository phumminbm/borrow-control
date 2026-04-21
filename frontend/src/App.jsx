import { useState, useEffect } from "react";
import SaleView from "./components/SaleView";
import AdminView from "./components/AdminView";

const MOCK_MODE = false;
const API_BASE  = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const TEAMS = {
  Bangkok:      ["TANG","OPAL","PAT","GAM","SHIRLEY","NAMPHUENG","CHOMPOO","RUNG"],
  North:        ["ICE","MAI","PLU"],
  "North-East": ["JONG","NING","HONGFAH","WHAN"],
  East:         ["EVE","MAMAEW","BEN"],
  South:        ["MOD"],
  Office:       ["NEO BIOTECH"],
};

export const TEAM_COLORS = {
  Bangkok:"#378ADD", North:"#1D9E75", "North-East":"#D85A30",
  East:"#7F77DD",    South:"#D4537E", Office:"#888780",
};

export const SC = {
  BLOCK:   { bg:"#FCEBEB", txt:"#A32D2D", bd:"#F09595", dot:"#E24B4A" },
  WARNING: { bg:"#FAEEDA", txt:"#854F0B", bd:"#FAC775", dot:"#EF9F27" },
  NORMAL:  { bg:"#EAF3DE", txt:"#3B6D11", bd:"#C0DD97", dot:"#639922" },
};

export function StatusBadge({ status }) {
  if (status === "BLOCK") return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#E24B4A", color:"#fff", borderRadius:5, padding:"3px 9px", fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:"rgba(255,255,255,0.7)", flexShrink:0 }}/>BLOCK
    </span>
  );
  if (status === "WARNING") return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#EF9F27", color:"#fff", borderRadius:5, padding:"3px 9px", fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:"rgba(255,255,255,0.7)", flexShrink:0 }}/>WARNING
    </span>
  );
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#EAF3DE", color:"#3B6D11", border:"0.5px solid #C0DD97", borderRadius:5, padding:"3px 9px", fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:"#639922", flexShrink:0 }}/>NORMAL
    </span>
  );
}

export default function App() {
  const [view, setView]           = useState("sale");
  const [customers, setCustomers] = useState([]);
  const [syncLogs, setSyncLogs]   = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [custValues, setCustValues] = useState({});
  const [loading, setLoading]     = useState(true);
  const [dark, setDark]           = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetch(`${API_BASE}/customers`).then(r => r.json()),
        fetch(`${API_BASE}/sync-logs`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/summary`).then(r => r.json()),
        fetch(`${API_BASE}/analytics/customer-value`).then(r => r.json()),
      ]).then(([custs, logs, anal, cv]) => {
        setCustomers(Array.isArray(custs) ? custs : []);
        setSyncLogs(Array.isArray(logs) ? logs : []);
        setAnalytics(anal?.error ? null : anal);
        setCustValues(cv?.error ? {} : cv);
      }).catch(() => {}).finally(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const D = {
    bg:      dark ? "#0f0f0f" : "#f5f5f3",
    navbar:  dark ? "#1a1a1a" : "#111",
    navBorder: dark ? "#333" : "#222",
    text:    dark ? "#eee"   : "#fff",
    subtext: dark ? "#666"   : "#777",
  };

  return (
    <div style={{ minHeight:"100vh", background:D.bg, transition:"background .2s" }}>

      {/* ── Navbar ── */}
      <div style={{ background:D.navbar, color:D.text, padding:"0 24px", height:50, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100, borderBottom:`0.5px solid ${D.navBorder}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:20, fontWeight:700, letterSpacing:"-0.8px" }}>
            <span style={{ color:"#D4357A" }}>Neo</span>Biotech
          </span>
          <span style={{
            fontSize:10, fontWeight:500, color:"#D4357A",
            background: dark ? "#2D0F1A" : "#FBE8F1",
            border:`0.5px solid ${dark ? "#7A2040" : "#F0A0C0"}`,
            borderRadius:4, padding:"2px 8px", letterSpacing:"0.5px",
          }}>BORROW SYSTEM</span>
        </div>

        <div style={{ display:"flex" }}>
          {[["sale","Sale"],["admin","Admin"]].map(([k,l]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding:"0 12px", height:50, fontSize:12, fontWeight:500,
              border:"none", borderBottom: view===k ? "2px solid #D4357A" : "2px solid transparent",
              background:"transparent", color: view===k ? "#fff" : D.subtext,
              cursor:"pointer", transition:"all .15s",
            }}>{l}</button>
          ))}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:"#888" }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:"#639922", display:"inline-block" }}/>
          </span>
          <button onClick={() => setDark(d => !d)} style={{
            width:48, height:26, borderRadius:28, border:"none", cursor:"pointer", padding:0,
            position:"relative", background: dark ? "#4A3F8F" : "#E8A020", transition:"background .3s", flexShrink:0,
          }}>
            <span style={{position:"absolute",left:5,top:"50%",transform:"translateY(-50%)",fontSize:11,opacity:dark?1:0,transition:"opacity .2s"}}>🌙</span>
            <span style={{position:"absolute",right:5,top:"50%",transform:"translateY(-50%)",fontSize:11,opacity:dark?0:1,transition:"opacity .2s"}}>☀️</span>
            <span style={{
              position:"absolute", top:3, left: dark ? 24 : 3,
              width:20, height:20, borderRadius:"50%", background:"#fff",
              boxShadow:"0 1px 4px rgba(0,0,0,0.3)", transition:"left .25s cubic-bezier(.4,0,.2,1)",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:10,
            }}>{dark ? "🌙" : "☀️"}</span>
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding:"14px 24px" }}>
        {loading ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:"#888", fontSize:13 }}>
            กำลังโหลดข้อมูล...
          </div>
        ) : view === "sale" ? (
          <SaleView customers={customers} dark={dark} custValues={custValues} analytics={analytics}/>
        ) : (
          <AdminView customers={customers} syncLogs={syncLogs} dark={dark} analytics={analytics}/>
        )}
      </div>
    </div>
  );
}