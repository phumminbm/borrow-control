import { useState, useEffect } from "react";
import { StatusBadge } from "../App";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const S = {
  overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 },
  modal:   { background:"#fff", borderRadius:12, width:"92%", maxWidth:640, maxHeight:"85vh", overflowY:"auto", border:"0.5px solid rgba(0,0,0,0.1)", display:"flex", flexDirection:"column" },
  mhead:   { padding:"13px 16px", borderBottom:"0.5px solid rgba(0,0,0,0.08)", display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexShrink:0 },
  mfoot:   { padding:"10px 16px", borderTop:"0.5px solid rgba(0,0,0,0.08)", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  btnBlue: { padding:"4px 10px", fontSize:11, fontWeight:500, borderRadius:6, cursor:"pointer", border:"0.5px solid #185FA5", background:"#E6F1FB", color:"#0C447C" },
  btnGray: { padding:"5px 14px", fontSize:12, borderRadius:7, cursor:"pointer", border:"0.5px solid rgba(0,0,0,0.15)", background:"#fff", color:"#555" },
  closeBtn:{ padding:"2px 6px", fontSize:14, border:"none", background:"none", cursor:"pointer", color:"#888", fontWeight:500 },
};

function badge(status) {
  const c = status==="BLOCK"?{bg:"#FCEBEB",txt:"#A32D2D",bd:"#F09595",dot:"#E24B4A"}
           :status==="WARNING"?{bg:"#FAEEDA",txt:"#854F0B",bd:"#FAC775",dot:"#EF9F27"}
           :{bg:"#EAF3DE",txt:"#3B6D11",bd:"#C0DD97",dot:"#639922"};
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,background:c.bg,color:c.txt,border:`0.5px solid ${c.bd}`,borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:c.dot,flexShrink:0}}/>{status}
  </span>;
}

function BRDetailModal({ br, onClose }) {
  if (!br) return null;
  const items = br.items || [];
  const total = items.reduce((s,i) => s + (Number(i.total_price)||0), 0);

  return (
    <div style={{...S.overlay, zIndex:1100}} onClick={e => e.target===e.currentTarget&&onClose()}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={S.mhead}>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{br.borrow_no}</div>
            <div style={{fontSize:11,color:"#888",marginTop:3,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <span>{br.borrow_date}</span><span>·</span>
              <span style={{color:br.days_borrowed>180?"#A32D2D":br.days_borrowed>90?"#854F0B":"#555",fontWeight:500}}>{br.days_borrowed} วัน</span>
              <span>·</span>{badge(br.borrow_alert)}
            </div>
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{padding:"12px 14px",flex:1}}>
          {items.length === 0 ? (
            <div style={{padding:"20px",textAlign:"center",fontSize:12,color:"#aaa"}}>ยังไม่มีข้อมูลสินค้า</div>
          ) : (
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:"#f5f5f3"}}>
                  {["รหัสสินค้า","ชื่อสินค้า","จำนวน","ราคา/หน่วย","รวม"].map(h=>(
                    <th key={h} style={{padding:"6px 10px",textAlign:["จำนวน","ราคา/หน่วย","รวม"].includes(h)?"right":"left",fontWeight:500,color:"#888",borderBottom:"0.5px solid rgba(0,0,0,0.08)"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item,i)=>(
                  <tr key={i} style={{borderBottom:"0.5px solid rgba(0,0,0,0.05)"}}>
                    <td style={{padding:"6px 10px",color:"#aaa"}}>{item.product_code}</td>
                    <td style={{padding:"6px 10px"}}>{item.product_name}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{item.quantity}</td>
                    <td style={{padding:"6px 10px",textAlign:"right"}}>{Number(item.price).toLocaleString()}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontWeight:500}}>{Number(item.total_price).toLocaleString()}</td>
                  </tr>
                ))}
                <tr style={{borderTop:"0.5px solid rgba(0,0,0,0.12)"}}>
                  <td colSpan={4} style={{padding:"7px 10px",textAlign:"right",fontWeight:500,color:"#888"}}>รวมทั้งหมด</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontWeight:600}}>{total.toLocaleString()} บาท</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <div style={S.mfoot}>
          <button style={S.btnGray} onClick={onClose}>← กลับ</button>
          <button style={S.btnGray} onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

function CustomerModal({ customer, onClose }) {
  const [brs, setBrs]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBr, setSelectedBr] = useState(null);

  useEffect(() => {
    if (!customer) return;
    setLoading(true);
    fetch(`${API_BASE}/customers/${customer.cust_code}/brs`)
      .then(r => r.json())
      .then(d => setBrs(Array.isArray(d) ? d : []))
      .catch(() => setBrs([]))
      .finally(() => setLoading(false));
  }, [customer]);

  if (!customer) return null;

  return (
    <>
      <div style={S.overlay} onClick={e => e.target===e.currentTarget&&onClose()}>
        <div style={S.modal} onClick={e=>e.stopPropagation()}>
          <div style={S.mhead}>
            <div>
              <div style={{fontSize:14,fontWeight:600}}>{customer.customer_name}</div>
              <div style={{fontSize:11,color:"#888",marginTop:3,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:"#f1f0eb",borderRadius:4,padding:"1px 7px",fontWeight:500,color:"#555"}}>{customer.cust_code}</span>
                <span>·</span><span>Sale: {customer.sale}</span><span>·</span>
                <span>{customer.active_br_count} BR active</span><span>·</span>
                <span style={{color:customer.max_days>180?"#A32D2D":customer.max_days>90?"#854F0B":"#555",fontWeight:500}}>
                  วันค้างสูงสุด {customer.max_days} วัน
                </span><span>·</span>
                {badge(customer.status)}
              </div>
            </div>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>

          <div style={{flex:1,overflowY:"auto"}}>
            {loading ? (
              <div style={{padding:"32px",textAlign:"center",fontSize:12,color:"#aaa"}}>กำลังโหลด BR...</div>
            ) : brs.length === 0 ? (
              <div style={{padding:"32px",textAlign:"center",fontSize:12,color:"#aaa"}}>ยังไม่มีข้อมูล BR</div>
            ) : brs.map(br => {
              const items = br.items || [];
              const total = items.reduce((s,i) => s+(Number(i.total_price)||0), 0);
              return (
                <div key={br.borrow_no} style={{padding:"11px 16px",borderBottom:"0.5px solid rgba(0,0,0,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                      <span style={{fontSize:12,fontWeight:500}}>{br.borrow_no}</span>
                      <span style={{fontSize:11,color:"#aaa"}}>{br.borrow_date}</span>
                      {badge(br.borrow_alert)}
                    </div>
                    <div style={{fontSize:11,color:"#aaa"}}>
                      <span style={{color:br.days_borrowed>180?"#A32D2D":br.days_borrowed>90?"#854F0B":"#888",fontWeight:br.days_borrowed>90?500:400}}>
                        {br.days_borrowed} วัน
                      </span>
                      {" · "}{items.length} รายการสินค้า{" · "}{total.toLocaleString()} บาท
                    </div>
                  </div>
                  <button style={{...S.btnBlue,flexShrink:0}} onClick={()=>setSelectedBr(br)}>ดูรายละเอียด</button>
                </div>
              );
            })}
          </div>

          <div style={S.mfoot}>
            <div/>
            <button style={S.btnGray} onClick={onClose}>ปิด</button>
          </div>
        </div>
      </div>
      {selectedBr && <BRDetailModal br={selectedBr} onClose={() => setSelectedBr(null)}/>}
    </>
  );
}

export default function SaleView({ customers }) {
  const [search, setSearch]           = useState("");
  const [saleFilter, setSaleFilter]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const allSales = [...new Set(customers.map(c => c.sale))].sort();

  const filtered = customers.filter(c =>
    (!search || 
      c.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      c.cust_code.toLowerCase().includes(search.toLowerCase())
    ) &&
    (!saleFilter || c.sale === saleFilter) &&
    (!statusFilter || c.status === statusFilter)
  ).sort((a,b) => b.max_days - a.max_days);

  const bl = filtered.filter(c => c.status==="BLOCK").length;
  const wa = filtered.filter(c => c.status==="WARNING").length;
  const rowBg = s => s==="BLOCK"?"rgba(252,235,235,0.35)":s==="WARNING"?"rgba(250,238,218,0.35)":"transparent";

  return (
    <div>
      {bl > 0 && (
        <div style={{background:"#FCEBEB",border:"0.5px solid #F09595",borderRadius:8,padding:"9px 14px",marginBottom:14,fontSize:12,color:"#791F1F",display:"flex",gap:6}}>
          <strong>แจ้งเตือน:</strong> มีลูกค้า BLOCK {bl} ราย ที่ค้างชำระเกิน 180 วัน — ติดต่อเพื่อเคลียสินค้าด่วน
        </div>
      )}

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["ลูกค้าทั้งหมด",filtered.length,null],["BLOCK",bl,"#A32D2D"],["WARNING",wa,"#854F0B"],["NORMAL",filtered.length-bl-wa,"#3B6D11"]].map(([label,val,color])=>(
          <div key={label} style={{background:"#f5f5f3",borderRadius:8,padding:"9px 14px",flex:1,minWidth:80}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>{label}</div>
            <div style={{fontSize:20,fontWeight:600,color:color||"#1a1a1a"}}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหารหัสหรือชื่อลูกค้า..."
          style={{flex:1,minWidth:180,maxWidth:280,padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,outline:"none"}}/>
        <select value={saleFilter} onChange={e=>setSaleFilter(e.target.value)}
          style={{padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,minWidth:140,background:"#fff"}}>
          <option value="">ทุก Sale</option>
          {allSales.map(s=><option key={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,background:"#fff"}}>
          <option value="">ทุกสถานะ</option>
          <option>BLOCK</option><option>WARNING</option><option>NORMAL</option>
        </select>
      </div>

      <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
          <thead style={{background:"#f9f9f7",borderBottom:"0.5px solid rgba(0,0,0,0.08)"}}>
            <tr>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"32px"}}>#</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"90px"}}>รหัสลูกค้า</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888"}}>ชื่อลูกค้า</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"90px"}}>Sale</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"50px"}}>BR</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"100px"}}>วันค้างสูงสุด</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"85px"}}>สถานะ</th>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",width:"110px"}}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{padding:"32px",textAlign:"center",fontSize:12,color:"#888"}}>ไม่พบลูกค้า</td></tr>
            ) : filtered.map((c,i)=>(
              <tr key={c.cust_code} style={{background:rowBg(c.status),borderBottom:"0.5px solid rgba(0,0,0,0.06)"}}>
                <td style={{padding:"9px 12px",fontSize:11,color:"#aaa"}}>{i+1}</td>
                <td style={{padding:"9px 12px",fontSize:11,fontWeight:500,color:"#555",fontFamily:"monospace"}}>{c.cust_code}</td>
                <td style={{padding:"9px 12px",fontSize:12,fontWeight:500}}>{c.customer_name}</td>
                <td style={{padding:"9px 12px",fontSize:11,color:"#777"}}>{c.sale}</td>
                <td style={{padding:"9px 12px",fontSize:11,color:"#777"}}>{c.active_br_count}</td>
                <td style={{padding:"9px 12px",fontSize:12,fontWeight:c.max_days>90?500:400,
                  color:c.max_days>180?"#A32D2D":c.max_days>90?"#854F0B":"#1a1a1a"}}>{c.max_days} วัน</td>
                <td style={{padding:"9px 12px"}}><StatusBadge status={c.status}/></td>
                <td style={{padding:"9px 12px"}}>
                  <button style={S.btnBlue} onClick={()=>setSelectedCustomer(c)}>ดูรายละเอียด</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCustomer && (
        <CustomerModal customer={selectedCustomer} onClose={()=>setSelectedCustomer(null)}/>
      )}
    </div>
  );
}
