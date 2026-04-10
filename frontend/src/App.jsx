import { useState, useEffect } from "react";
import SaleView from "./components/SaleView";
import AdminView from "./components/AdminView";

const MOCK_MODE = false; // เปลี่ยนเป็น false เมื่อเชื่อม API จริง
const API_BASE  = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const TEAMS = {
  Bangkok:      ["PAT","OPAL","TANG","GAM","SHIRLEY","NAMPHUENG","CHOMPOO","RUNG"],
  "North-East": ["JONG","NING","HONGFAH","WHAN"],
  East:         ["EVE","MAMAEW","BEN"],
  North:        ["ICE","MAI","PLU"],
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
  const [view, setView]         = useState("sale");
  const [customers, setCustomers] = useState([]);
  const [syncLogs, setSyncLogs]   = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (MOCK_MODE) {
      setCustomers(generateMock());
      setSyncLogs(MOCK_LOGS);
      setLoading(false);
      return;
    }
    Promise.all([
      fetch(`${API_BASE}/customers`).then(r => r.json()),
      fetch(`${API_BASE}/sync-logs`).then(r => r.json()),
    ]).then(([custs, logs]) => {
      setCustomers(custs);
      setSyncLogs(logs);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight:"100vh", background:"var(--color-background-tertiary, #f5f5f3)" }}>
      {/* Topbar */}
      <div style={{ background:"#fff", borderBottom:"0.5px solid rgba(0,0,0,0.1)", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:52, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:28, height:28, background:"#185FA5", borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" rx="1.5" fill="white"/>
              <rect x="9" y="2" width="5" height="5" rx="1.5" fill="white" opacity=".55"/>
              <rect x="2" y="9" width="5" height="5" rx="1.5" fill="white" opacity=".55"/>
              <rect x="9" y="9" width="5" height="5" rx="1.5" fill="white"/>
            </svg>
          </div>
          <span style={{ fontWeight:600, fontSize:14, color:"#1a1a1a" }}>Borrow Control</span>
        </div>

        <div style={{ display:"flex", gap:3, background:"#f1f0eb", padding:3, borderRadius:10 }}>
          {[["sale","Sale View"],["admin","Admin View"]].map(([k,l]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding:"5px 14px", fontSize:12, fontWeight:500, border:"none", borderRadius:7, cursor:"pointer",
              background: view===k ? "#fff" : "transparent",
              color: view===k ? "#1a1a1a" : "#888",
              boxShadow: view===k ? "0 0 0 0.5px rgba(0,0,0,0.12)" : "none",
              transition:"all .15s",
            }}>{l}</button>
          ))}
        </div>

        <div style={{ fontSize:11, color:"#888" }}>
          <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", background:"#639922", marginRight:5 }}/>
          Sync ทุก 5 นาที
        </div>
      </div>

      <div style={{ padding:"20px 24px", maxWidth:1400, margin:"0 auto" }}>
        {loading ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:"#888", fontSize:13 }}>
            กำลังโหลดข้อมูล...
          </div>
        ) : view === "sale" ? (
          <SaleView customers={customers} />
        ) : (
          <AdminView customers={customers} syncLogs={syncLogs} />
        )}
      </div>
    </div>
  );
}

// ── Mock data generator ─────────────────────────────────────────────
const CUST_NAMES = ["รพ.กรุงเทพ","รพ.นครพิงค์","คลินิกสุขภาพ","รพ.สมิติเวช","รพ.ราษฎร์บูรณะ","คลินิกหมอสมใจ","รพ.พญาไท","รพ.บำรุงราษฎร์","รพ.สระบุรี","รพ.เชียงราย"];
const PRODS = [
  {code:"MED-001",name:"Surgical Clamp Set",price:12500},
  {code:"MED-015",name:"Laparoscope 10mm",price:45000},
  {code:"MED-030",name:"ECG Monitor",price:32000},
  {code:"MED-055",name:"Ventilator Circuit",price:2800},
  {code:"MED-071",name:"Infusion Pump",price:28000},
  {code:"MED-090",name:"Surgical Light",price:85000},
  {code:"DEN-010",name:"Dental Mirror Set",price:450},
];
const rnd = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

function generateMock() {
  let id=1, bid=1, custs=[];
  Object.entries(TEAMS).forEach(([team,sales]) => {
    sales.forEach(sale => {
      for (let i=0; i<rnd(4,12); i++) {
        const brCount = rnd(1,4);
        const brs = Array.from({length:brCount}, () => {
          const days = rnd(5,250);
          const items = Array.from({length:rnd(1,3)}, () => {
            const p = PRODS[rnd(0,PRODS.length-1)];
            const qty = rnd(1,5);
            return {...p, qty, total_price: p.price*qty};
          });
          return {
            borrow_no: `BR-2024-${String(bid++).padStart(4,"0")}`,
            borrow_date: `${rnd(1,28).toString().padStart(2,"0")}/${rnd(1,9).toString().padStart(2,"0")}/2024`,
            days_borrowed: days,
            borrow_alert: days>180?"BLOCK":days>90?"WARNING":"NORMAL",
            items,
          };
        });
        const maxDays = Math.max(...brs.map(b=>b.days_borrowed));
        custs.push({
          id: id++,
          cust_code: `C${String(id).padStart(4,"0")}`,
          customer_name: `${CUST_NAMES[rnd(0,CUST_NAMES.length-1)]} สาขา ${id}`,
          team, sale,
          status: maxDays>180?"BLOCK":maxDays>90?"WARNING":"NORMAL",
          max_days: maxDays,
          active_br_count: brCount,
          total_value: brs.flatMap(b=>b.items).reduce((s,i)=>s+i.total_price,0),
          brs,
        });
      }
    });
  });
  return custs;
}

const MOCK_LOGS = [
  {synced_at:"14:35:02",status:"success",sheet_rows:36218,br_inserted:12,br_updated:47,br_closed:3, errors:0,duration_ms:2100},
  {synced_at:"14:30:01",status:"success",sheet_rows:36206,br_inserted:4, br_updated:18,br_closed:0, errors:0,duration_ms:1800},
  {synced_at:"14:25:00",status:"partial",sheet_rows:36202,br_inserted:7, br_updated:31,br_closed:1, errors:1,duration_ms:3200,error_msg:"Row 4821: parse error"},
  {synced_at:"14:20:02",status:"success",sheet_rows:36195,br_inserted:0, br_updated:9, br_closed:0, errors:0,duration_ms:1400},
];
