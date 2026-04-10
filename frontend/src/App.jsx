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
  const c = SC[status] || SC.NORMAL;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:c.bg, color:c.txt, border:`0.5px solid ${c.bd}`, borderRadius:5, padding:"2px 8px", fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:c.dot, flexShrink:0 }}/>
      {status}
    </span>
  );
}

export default function App() {
  const [view, setView]           = useState("sale");
  const [customers, setCustomers] = useState([]);
  const [syncLogs, setSyncLogs]   = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetch(`${API_BASE}/customers`).then(r => r.json()),
        fetch(`${API_BASE}/sync-logs`).then(r => r.json()),
      ]).then(([custs, logs]) => {
        setCustomers(Array.isArray(custs) ? custs : []);
        setSyncLogs(Array.isArray(logs) ? logs : []);
      }).catch(() => {}).finally(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ minHeight:"100vh", background:"#f5f5f3" }}>

      {/* ── Navbar ── */}
      <div style={{ background:"#111", color:"#fff", padding:"0 24px", height:50, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:15, fontWeight:500, letterSpacing:"-0.3px" }}>
            <span style={{ color:"#E24B4A" }}>Neo</span>Biotech
          </span>
          <span style={{ color:"#444", fontSize:13 }}>|</span>
          <span style={{ fontSize:13, color:"#aaa", fontWeight:400 }}>Borrow Control</span>
        </div>

        <div style={{ display:"flex" }}>
          {[["sale","Sale View"],["admin","Admin View"]].map(([k,l]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding:"0 18px", height:50, fontSize:12, fontWeight:500,
              border:"none", borderBottom: view===k ? "2px solid #fff" : "2px solid transparent",
              background:"transparent", color: view===k ? "#fff" : "#777",
              cursor:"pointer", transition:"all .15s",
            }}>{l}</button>
          ))}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:11, color:"#888" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:"#639922", display:"inline-block" }}/>
            Sync ทุก 5 นาที
          </span>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding:"20px 24px", maxWidth:1400, margin:"0 auto" }}>
        {loading ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:"#888", fontSize:13 }}>
            กำลังโหลดข้อมูล...
          </div>
        ) : view === "sale" ? (
          <SaleView customers={customers}/>
        ) : (
          <AdminView customers={customers} syncLogs={syncLogs}/>
        )}
      </div>
    </div>
  );
}
