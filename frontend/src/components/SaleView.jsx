import { useState, useEffect } from "react";
import { SC, StatusBadge } from "../App";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function SaleView({ customers }) {
  const [search, setSearch]           = useState("");
  const [saleFilter, setSaleFilter]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedCode, setSelectedCode] = useState(null);
  const [openBr, setOpenBr]           = useState(null);
  const [brs, setBrs]                 = useState([]);
  const [loadingBrs, setLoadingBrs]   = useState(false);

  const allSales = [...new Set(customers.map(c => c.sale))].sort();

  const filtered = customers.filter(c =>
    (!search || c.customer_name.toLowerCase().includes(search.toLowerCase())) &&
    (!saleFilter || c.sale === saleFilter) &&
    (!statusFilter || c.status === statusFilter)
  ).sort((a,b) => b.max_days - a.max_days);

  const bl = filtered.filter(c => c.status==="BLOCK").length;
  const wa = filtered.filter(c => c.status==="WARNING").length;

  const selected = customers.find(c => c.cust_code === selectedCode);

  // ดึง BR จาก API เมื่อเลือกลูกค้า
  useEffect(() => {
    if (!selectedCode) { setBrs([]); return; }
    setLoadingBrs(true);
    fetch(`${API_BASE}/customers/${selectedCode}/brs`)
      .then(r => r.json())
      .then(data => setBrs(Array.isArray(data) ? data : []))
      .catch(() => setBrs([]))
      .finally(() => setLoadingBrs(false));
  }, [selectedCode]);

  const rowBg = s => s==="BLOCK"?"rgba(252,235,235,0.35)":s==="WARNING"?"rgba(250,238,218,0.35)":"transparent";

  return (
    <div>
      {/* Alert banner */}
      {bl > 0 && (
        <div style={{ background:"#FCEBEB", border:"0.5px solid #F09595", borderRadius:8, padding:"9px 14px", marginBottom:14, fontSize:12, color:"#791F1F", display:"flex", gap:6 }}>
          <strong>แจ้งเตือน:</strong> มีลูกค้า BLOCK {bl} ราย ที่ค้างชำระเกิน 180 วัน — ติดต่อเพื่อเคลียสินค้าด่วน
        </div>
      )}

      {/* Metrics */}
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        {[["ลูกค้าทั้งหมด", filtered.length, null],["BLOCK", bl, "#A32D2D"],["WARNING", wa, "#854F0B"],["NORMAL", filtered.length-bl-wa, "#3B6D11"]].map(([label,val,color]) => (
          <div key={label} style={{ background:"#f5f5f3", borderRadius:8, padding:"9px 14px", flex:1, minWidth:80 }}>
            <div style={{ fontSize:11, color:"#888", marginBottom:2 }}>{label}</div>
            <div style={{ fontSize:20, fontWeight:600, color: color || "#1a1a1a" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาชื่อลูกค้า..."
          style={{ flex:1, minWidth:160, maxWidth:260, padding:"7px 10px", fontSize:12, border:"0.5px solid rgba(0,0,0,0.15)", borderRadius:8, outline:"none" }}/>
        <select value={saleFilter} onChange={e=>setSaleFilter(e.target.value)}
          style={{ padding:"7px 10px", fontSize:12, border:"0.5px solid rgba(0,0,0,0.15)", borderRadius:8, minWidth:140, background:"#fff" }}>
          <option value="">ทุก Sale</option>
          {allSales.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{ padding:"7px 10px", fontSize:12, border:"0.5px solid rgba(0,0,0,0.15)", borderRadius:8, background:"#fff" }}>
          <option value="">ทุกสถานะ</option>
          <option>BLOCK</option><option>WARNING</option><option>NORMAL</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background:"#fff", border:"0.5px solid rgba(0,0,0,0.1)", borderRadius:10, overflow:"hidden", marginBottom:12 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
          <thead style={{ background:"#f9f9f7", borderBottom:"0.5px solid rgba(0,0,0,0.08)" }}>
            <tr>
              {["#","ชื่อลูกค้า","Sale","BR","วันค้างสูงสุด","สถานะ"].map((h,i) => (
                <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:500, color:"#888",
                  width: i===0?"32px":i===2?"110px":i===3?"60px":i===4?"110px":i===5?"100px":"auto" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding:"32px", textAlign:"center", fontSize:12, color:"#888" }}>ไม่พบลูกค้า</td></tr>
            ) : filtered.map((c,i) => (
              <tr key={c.cust_code}
                onClick={() => { setSelectedCode(selectedCode===c.cust_code?null:c.cust_code); setOpenBr(null); }}
                style={{ background: selectedCode===c.cust_code?"rgba(55,138,221,0.08)":rowBg(c.status), cursor:"pointer", borderBottom:"0.5px solid rgba(0,0,0,0.06)", transition:"background .12s" }}>
                <td style={{ padding:"9px 12px", fontSize:11, color:"#aaa" }}>{i+1}</td>
                <td style={{ padding:"9px 12px", fontSize:12, fontWeight:500 }}>{c.customer_name}</td>
                <td style={{ padding:"9px 12px", fontSize:11, color:"#777" }}>{c.sale}</td>
                <td style={{ padding:"9px 12px", fontSize:11, color:"#777" }}>{c.active_br_count}</td>
                <td style={{ padding:"9px 12px", fontSize:12, fontWeight: c.max_days>90?500:400,
                  color: c.max_days>180?"#A32D2D":c.max_days>90?"#854F0B":"#1a1a1a" }}>{c.max_days} วัน</td>
                <td style={{ padding:"9px 12px" }}><StatusBadge status={c.status}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* BR Detail Panel */}
      {selected && (
        <div style={{ background:"#fff", border:"0.5px solid rgba(0,0,0,0.1)", borderRadius:10, overflow:"hidden" }}>
          <div style={{ padding:"11px 14px", borderBottom:"0.5px solid rgba(0,0,0,0.08)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600 }}>{selected.customer_name}</div>
              <div style={{ fontSize:11, color:"#888", marginTop:2 }}>Sale: {selected.sale} · {selected.active_br_count} BR active · วันค้างสูงสุด {selected.max_days} วัน</div>
            </div>
            <button onClick={() => { setSelectedCode(null); setBrs([]); }}
              style={{ padding:"4px 10px", fontSize:11, border:"0.5px solid rgba(0,0,0,0.15)", borderRadius:6, background:"#fff", cursor:"pointer" }}>ปิด</button>
          </div>

          {loadingBrs ? (
            <div style={{ padding:"24px", textAlign:"center", fontSize:12, color:"#aaa" }}>กำลังโหลด BR...</div>
          ) : brs.length === 0 ? (
            <div style={{ padding:"24px", textAlign:"center", fontSize:12, color:"#aaa" }}>ยังไม่มีข้อมูล BR</div>
          ) : (
            <div>
              {brs.map(br => {
                const isOpen = openBr === br.borrow_no;
                const items = br.items || [];
                const total = items.reduce((s,i) => s + (Number(i.total_price) || 0), 0);
                return (
                  <div key={br.borrow_no}>
                    <div onClick={() => setOpenBr(isOpen ? null : br.borrow_no)}
                      style={{ padding:"10px 14px", borderBottom:"0.5px solid rgba(0,0,0,0.06)", cursor:"pointer", background: isOpen?"#f9f9f7":"#fff", transition:"background .12s" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ fontSize:12, fontWeight:500 }}>{br.borrow_no}</span>
                          <span style={{ fontSize:11, color:"#aaa" }}>{br.borrow_date}</span>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:11, fontWeight: br.days_borrowed>90?500:400,
                            color: br.days_borrowed>180?"#A32D2D":br.days_borrowed>90?"#854F0B":"#888" }}>{br.days_borrowed} วัน</span>
                          <StatusBadge status={br.borrow_alert}/>
                          <span style={{ fontSize:10, color:"#bbb" }}>{isOpen?"▲":"▼"}</span>
                        </div>
                      </div>
                      <div style={{ fontSize:11, color:"#aaa", marginTop:3 }}>
                        {items.length} รายการ · {total.toLocaleString()} บาท
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ padding:"0 14px 12px", background:"#fafaf8" }}>
                        {items.length === 0 ? (
                          <div style={{ padding:"12px 0", fontSize:11, color:"#aaa" }}>ไม่มีรายการสินค้า</div>
                        ) : (
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, marginTop:8 }}>
                            <thead>
                              <tr style={{ background:"#f1f0eb" }}>
                                {["รหัสสินค้า","ชื่อสินค้า","จำนวน","ราคา/หน่วย","รวม"].map(h => (
                                  <th key={h} style={{ padding:"5px 10px", textAlign: ["จำนวน","ราคา/หน่วย","รวม"].includes(h)?"right":"left", fontWeight:500, color:"#888", borderBottom:"0.5px solid rgba(0,0,0,0.08)" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item,idx) => (
                                <tr key={idx} style={{ borderBottom:"0.5px solid rgba(0,0,0,0.05)" }}>
                                  <td style={{ padding:"5px 10px", color:"#aaa" }}>{item.product_code}</td>
                                  <td style={{ padding:"5px 10px" }}>{item.product_name}</td>
                                  <td style={{ padding:"5px 10px", textAlign:"right" }}>{item.quantity}</td>
                                  <td style={{ padding:"5px 10px", textAlign:"right" }}>{Number(item.price).toLocaleString()}</td>
                                  <td style={{ padding:"5px 10px", textAlign:"right", fontWeight:500 }}>{Number(item.total_price).toLocaleString()}</td>
                                </tr>
                              ))}
                              <tr style={{ borderTop:"0.5px solid rgba(0,0,0,0.1)" }}>
                                <td colSpan={4} style={{ padding:"6px 10px", textAlign:"right", fontWeight:500, color:"#888" }}>รวมทั้งหมด</td>
                                <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:600 }}>{total.toLocaleString()} บาท</td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
