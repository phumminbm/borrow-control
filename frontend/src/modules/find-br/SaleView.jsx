import { useState, useEffect } from "react";
import { StatusBadge, T } from "../../App";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openPrintWindow(title = "Print PDF") {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to print the PDF.");
    return null;
  }
  const safeTitle = escapeHtml(title);
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${safeTitle}</title>
        <style>
          html, body { margin: 0; height: 100%; overflow: hidden; }
          iframe { width: 100%; height: 100vh; border: 0; }
        </style>
      </head>
      <body>
        <iframe id="pdfFrame" title="${safeTitle}"></iframe>
        <script>
          var frame = document.getElementById("pdfFrame");
          frame.onload = function () {
            setTimeout(function () {
              frame.contentWindow.focus();
              frame.contentWindow.print();
            }, 350);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  return printWindow;
}

function printPdfBlob(blob, title = "Print PDF", printWindow = null) {
  const targetWindow = printWindow || openPrintWindow(title);
  if (!targetWindow) return null;
  const blobUrl = URL.createObjectURL(blob);
  targetWindow.document.getElementById("pdfFrame").src = blobUrl;
  targetWindow.addEventListener("beforeunload", () => URL.revokeObjectURL(blobUrl), { once: true });
  return targetWindow;
}

async function printPdfFromUrl(pdfUrl, title = "Print PDF") {
  const printWindow = openPrintWindow(title);
  if (!printWindow) return;
  try {
    const res = await fetch(pdfUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
    const blob = await res.blob();
    printPdfBlob(blob, title, printWindow);
  } catch (err) {
    printWindow.close();
    alert(`Print failed: ${err.message}`);
  }
}

function getS(dark) { return {
  overlay:  { position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 },
  modal:    { background:dark?"#1a1a1a":"#fff", borderRadius:12, width:"92%", maxWidth:640, maxHeight:"90vh", overflowY:"auto", border:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.1)"}`, display:"flex", flexDirection:"column" },
  mhead:    { padding:"13px 16px", borderBottom:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.08)"}`, display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexShrink:0 },
  mfoot:    { padding:"10px 16px", borderTop:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.08)"}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  btnBlue:  { padding:"4px 10px", fontSize:11, fontWeight:500, borderRadius:6, cursor:"pointer", border:"0.5px solid #185FA5", background:dark?"#0C2A4A":"#E6F1FB", color:dark?"#7BB8F5":"#0C447C" },
  btnGray:  { padding:"5px 14px", fontSize:12, borderRadius:7, cursor:"pointer", border:`0.5px solid ${dark?"#333":"rgba(0,0,0,0.15)"}`, background:dark?"#222":"#fff", color:dark?"#aaa":"#555" },
  closeBtn: { padding:"2px 6px", fontSize:14, border:"none", background:"none", cursor:"pointer", color:"#888", fontWeight:500 },
}; }

function badge(status, dark) {
  if (status==="BLOCK") return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,
      background:dark?"#3D1212":"#E24B4A", color:dark?"#F09595":"#fff",
      border:dark?"0.5px solid #7A2020":"none",
      borderRadius:5,padding:"3px 9px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:dark?"#E24B4A":"rgba(255,255,255,0.7)",flexShrink:0}}/>BLOCK
    </span>
  );
  if (status==="WARNING") return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,
      background:dark?"#3D2A00":"#EF9F27", color:dark?"#FAC775":"#fff",
      border:dark?"0.5px solid #7A5500":"none",
      borderRadius:5,padding:"3px 9px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:dark?"#EF9F27":"rgba(255,255,255,0.7)",flexShrink:0}}/>WARNING
    </span>
  );
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,
      background:dark?"#1A2E0A":"#EAF3DE", color:dark?"#C0DD97":"#3B6D11",
      border:`0.5px solid ${dark?"#3A6014":"#C0DD97"}`,
      borderRadius:5,padding:"3px 9px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:"#639922",flexShrink:0}}/>NORMAL
    </span>
  );
}

function BRDetailModal({ br, onClose, dark, t }) {
  if (!br) return null;
  const S = getS(dark);
  const items = br.items || [];
  const total = items.reduce((s,i) => s + (Number(i.price)||0) * (Number(i.quantity)||0), 0);
  const txt = dark ? "#ddd" : "#111";
  const sub = dark ? "#666" : "#555";
  const bdr = dark ? "#2a2a2a" : "rgba(0,0,0,0.08)";

  return (
    <div style={{...S.overlay, zIndex:1100}} onClick={e => e.target===e.currentTarget&&onClose()}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={S.mhead}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:txt}}>{br.borrow_no}</div>
            <div style={{fontSize:11,color:"#888",marginTop:3,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <span>{br.borrow_date}</span><span>·</span>
              <span style={{color:br.days_borrowed>180?(dark?"#F09595":"#A32D2D"):br.days_borrowed>90?(dark?"#FAC775":"#854F0B"):sub,fontWeight:500}}>{br.days_borrowed} {t.days}</span>
              <span>·</span>{badge(br.borrow_alert, dark)}
            </div>
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{padding:"12px 14px",flex:1}}>
          {items.length === 0 ? (
            <div style={{padding:"20px",textAlign:"center",fontSize:12,color:"#aaa"}}>{t.noProduct}</div>
          ) : (
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:dark?"#222":"#f5f5f3"}}>
                  {["#",t.productCode,t.productName,t.qty,t.price,t.total].map(h=>(
                    <th key={h} style={{padding:"6px 10px",textAlign:[t.qty,t.price,t.total].includes(h)?"right":"left",fontWeight:600,color:sub,borderBottom:`0.5px solid ${bdr}`,width:h==="#"?"32px":undefined}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item,i)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${dark?"#222":"rgba(0,0,0,0.05)"}`}}>
                    <td style={{padding:"6px 10px",color:"#888",fontWeight:500}}>{i+1}</td>
                    <td style={{padding:"6px 10px",color:dark?"#aaa":"#333",fontWeight:500}}>{item.product_code}</td>
                    <td style={{padding:"6px 10px",color:txt}}>{item.product_name}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:dark?"#aaa":"#333"}}>{item.quantity}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:dark?"#aaa":"#333"}}>{Number(item.price).toLocaleString()}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,color:txt}}>{(Number(item.price) * Number(item.quantity)).toLocaleString()}</td>
                  </tr>
                ))}
                <tr style={{borderTop:`0.5px solid ${dark?"#333":"rgba(0,0,0,0.12)"}`,background:dark?"#222":"#f9f9f7"}}>
                  <td colSpan={5} style={{padding:"7px 10px",textAlign:"right",fontWeight:600,color:sub}}>{t.grandTotal}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:txt}}>{total.toLocaleString()} บาท</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        {br.remark && (
          <div style={{padding:"10px 14px",borderTop:`0.5px solid ${bdr}`}}>
            <div style={{fontSize:10,fontWeight:600,color:sub,textTransform:"uppercase",letterSpacing:0.8,marginBottom:4}}>Remark</div>
            <div style={{fontSize:12,color:txt,background:dark?"#1a1a1a":"#f9f9f7",border:`0.5px solid ${bdr}`,borderRadius:7,padding:"7px 10px"}}>{br.remark}</div>
          </div>
        )}
        <div style={S.mfoot}>
          <button style={S.btnGray} onClick={onClose}>← กลับ</button>
          <div style={{display:"flex",gap:8}}>
            <button
              onClick={() => window.open(`${API_BASE}/brs/${br.borrow_no}/pdf`, "_blank")}
              style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:7,border:"none",background:"#D4357A",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="white"><path d="M2 13h12v1.5H2V13zm6-2L4.5 7.5l1.1-1.1 1.65 1.65V2h1.5v6.05l1.65-1.65L11.5 7.5 8 11z"/></svg>
              Export PDF
            </button>
            <button
              onClick={() => printPdfFromUrl(`${API_BASE}/brs/${br.borrow_no}/pdf`, br.borrow_no)}
              style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:7,border:"0.5px solid #185FA5",background:dark?"#0C2A4A":"#E6F1FB",color:dark?"#7BB8F5":"#0C447C",fontSize:12,fontWeight:600,cursor:"pointer"}}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5h8v3H4v-3Zm-1 9.75h10v3.25H3v-3.25ZM2 5.5h12A1.5 1.5 0 0 1 15.5 7v4.25H13.8V9.7H2.2v1.55H.5V7A1.5 1.5 0 0 1 2 5.5Zm10.5 1.65a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>
              Print
            </button>
            <button style={S.btnGray} onClick={onClose}>ปิด</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerModal({ customer, onClose, dark, t }) {
  const [brs, setBrs]               = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedBr, setSelectedBr] = useState(null);
  const [brSearch, setBrSearch]     = useState("");
  const [brFilter, setBrFilter]     = useState("");
  const [brFilterOpen, setBrFilterOpen] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [exporting, setExporting]   = useState(false);
  const S   = getS(dark);
  const txt = dark ? "#ddd" : "#111";
  const sub = dark ? "#555" : "#555";
  const bdr = dark ? "#2a2a2a" : "rgba(0,0,0,0.06)";

  useEffect(() => {
    if (!customer) return;
    setLoading(true); setBrSearch(""); setBrFilter(""); setBrFilterOpen(false); setSelected(new Set());
    fetch(`${API_BASE}/customers/${customer.cust_code}/brs`)
      .then(r => r.json())
      .then(d => setBrs(Array.isArray(d) ? d : []))
      .catch(() => setBrs([]))
      .finally(() => setLoading(false));
  }, [customer]);

  if (!customer) return null;

  const filteredBrs = brs.filter(br =>
    (!brSearch || br.borrow_no.toLowerCase().includes(brSearch.toLowerCase())) &&
    (!brFilter || br.borrow_alert === brFilter)
  );

  const toggleOne = (bno) => setSelected(prev => {
    const next = new Set(prev);
    next.has(bno) ? next.delete(bno) : next.add(bno);
    return next;
  });

  const allSelected = filteredBrs.length > 0 && filteredBrs.every(br => selected.has(br.borrow_no));
  const someSelected = filteredBrs.some(br => selected.has(br.borrow_no));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); filteredBrs.forEach(br => next.delete(br.borrow_no)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); filteredBrs.forEach(br => next.add(br.borrow_no)); return next; });
    }
  };

  const handleBulkExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/export-pdf/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrow_nos: [...selected],
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

  const handleBulkPrint = async () => {
    const title = `${customer?.customer_name || "customer"}(${customer?.cust_code || ""})_All BR`;
    const printWindow = openPrintWindow(title);
    if (!printWindow) return;
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/export-pdf/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrow_nos: [...selected],
          cust_code: customer?.cust_code || "",
          customer_name: customer?.customer_name || ""
        })
      });
      if (!res.ok) throw new Error("Print failed");
      const blob = await res.blob();
      printPdfBlob(blob, title, printWindow);
    } catch (e) {
      printWindow.close();
      alert("Print ไม่สำเร็จ: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {/* ── Export Loading Overlay ── */}
      {exporting && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: dark ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.82)",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 20,
        }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>📄</div>
          <div style={{
            width: 58, height: 58, borderRadius: "50%",
            border: `3.5px solid ${dark ? "#2a0d1a" : "#f0d0dc"}`,
            borderTopColor: "#D4357A",
            animation: "nbspin 0.85s linear infinite",
          }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: dark ? "#fff" : "#111", marginBottom: 6 }}>
              กำลัง Export PDF
            </div>
            <div style={{ fontSize: 13, color: "#888" }}>กรุณารอสักครู่...</div>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: dark ? "#2D0F1A" : "#FBE8F1",
            border: "0.5px solid #D4357A55", borderRadius: 8,
            padding: "6px 16px", fontSize: 12, fontWeight: 600, color: "#D4357A",
          }}>
            <svg width={13} height={13} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path d="M12 2L3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5" stroke="#D4357A" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            รวม {selected.size} ใบ
          </div>
          <style>{`@keyframes nbspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      <div style={S.overlay} onClick={e => e.target===e.currentTarget&&onClose()}>
        <div style={S.modal} onClick={e=>e.stopPropagation()}>
          <div style={S.mhead}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:txt}}>{customer.customer_name}</div>
              {customer.address && (
                <div style={{display:"flex",alignItems:"flex-start",gap:5,marginTop:3,marginBottom:4}}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={dark?"#eee":"#111"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,marginTop:2}}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span style={{fontSize:11,color:dark?"#eee":"#111",fontWeight:400,lineHeight:1.5}}>{customer.address}</span>
                </div>
              )}
              <div style={{fontSize:11,color:"#888",marginTop:3,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:dark?"#222":"#f1f0eb",borderRadius:4,padding:"1px 7px",fontWeight:500,color:dark?"#aaa":"#555"}}>{customer.cust_code}</span>
                <span>·</span><span style={{color:"#888"}}>Sale: {customer.sale}</span><span>·</span>
                <span style={{color:"#888"}}>{customer.active_br_count} {t.brActive}</span><span>·</span>
                <span style={{color:customer.max_days>180?(dark?"#F09595":"#A32D2D"):customer.max_days>90?(dark?"#FAC775":"#854F0B"):"#888",fontWeight:500}}>
                  วันค้างสูงสุด {customer.max_days} วัน
                </span><span>·</span>
                {badge(customer.status, dark)}
              </div>
            </div>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>

          {/* ── Select toolbar ── */}
          {!loading && brs.length > 0 && (
            <div style={{padding:"7px 16px",borderBottom:`0.5px solid ${bdr}`,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:dark?"#ccc":"#444"}}>
                <div
                  onClick={toggleAll}
                  style={{width:15,height:15,borderRadius:3,border:`1.5px solid ${someSelected?"#D4357A":dark?"#444":"#bbb"}`,background:allSelected?"#D4357A":someSelected?"#7a1840":"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}
                >
                  {allSelected && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                  {someSelected && !allSelected && <div style={{width:7,height:7,background:"#D4357A",borderRadius:1}}/>}
                </div>
                เลือกทั้งหมด
              </label>
              {selected.size > 0 && <span style={{fontSize:11,color:"#888"}}>{selected.size} ใบเลือกแล้ว</span>}
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
                {selected.size > 0 && (
                  <>
                  <button
                    onClick={handleBulkExport}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:6,border:"none",background:"#D4357A",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer"}}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="white"><path d="M2 13h12v1.5H2V13zm6-2L4.5 7.5l1.1-1.1 1.65 1.65V2h1.5v6.05l1.65-1.65L11.5 7.5 8 11z"/></svg>
                    Export ({selected.size})
                  </button>
                  <button
                    onClick={handleBulkPrint}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:6,border:"0.5px solid #185FA5",background:dark?"#0C2A4A":"#E6F1FB",color:dark?"#7BB8F5":"#0C447C",fontSize:11,fontWeight:600,cursor:"pointer"}}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5h8v3H4v-3Zm-1 9.75h10v3.25H3v-3.25ZM2 5.5h12A1.5 1.5 0 0 1 15.5 7v4.25H13.8V9.7H2.2v1.55H.5V7A1.5 1.5 0 0 1 2 5.5Zm10.5 1.65a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>
                    Print ({selected.size})
                  </button>
                  </>
                )}
                {/* ── BR Status Filter Dropdown ── */}
                <div style={{position:"relative"}}>
                  <button
                    onClick={() => setBrFilterOpen(o => !o)}
                    style={{
                      display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,
                      border:`0.5px solid ${brFilter==="BLOCK"?"#E24B4A":brFilter==="WARNING"?"#EF9F27":brFilter==="NORMAL"?"#639922":dark?"#333":"rgba(0,0,0,0.15)"}`,
                      background:brFilter==="BLOCK"?(dark?"#2D0A0A":"#FFF0F0"):brFilter==="WARNING"?(dark?"#2D1E00":"#FFF8E8"):brFilter==="NORMAL"?(dark?"#0A2D0A":"#F0FAE8"):(dark?"#1a1a1a":"#f5f5f3"),
                      color:brFilter==="BLOCK"?"#E24B4A":brFilter==="WARNING"?"#EF9F27":brFilter==="NORMAL"?"#639922":(dark?"#aaa":"#555"),
                    }}
                  >
                    <span style={{width:6,height:6,borderRadius:"50%",background:brFilter==="BLOCK"?"#E24B4A":brFilter==="WARNING"?"#EF9F27":brFilter==="NORMAL"?"#639922":(dark?"#444":"#bbb"),flexShrink:0}}/>
                    {brFilter||"ทั้งหมด"}
                    <svg width={10} height={10} viewBox="0 0 24 24" style={{transform:brFilterOpen?"rotate(180deg)":"none",transition:"transform .15s"}}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {brFilterOpen && (
                    <>
                      <div style={{position:"fixed",inset:0,zIndex:199}} onClick={()=>setBrFilterOpen(false)}/>
                      <div style={{
                        position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:200,
                        background:dark?"#1a1a1a":"#fff",
                        border:`0.5px solid ${dark?"#333":"rgba(0,0,0,0.12)"}`,
                        borderRadius:9,boxShadow:"0 4px 16px rgba(0,0,0,0.18)",
                        minWidth:150,padding:"4px 0",overflow:"hidden",
                      }}>
                        {[
                          {value:"",label:"ทั้งหมด",dot:dark?"#555":"#bbb",col:dark?"#ccc":"#444"},
                          {value:"BLOCK",label:"BLOCK",dot:"#E24B4A",col:"#E24B4A"},
                          {value:"WARNING",label:"WARNING",dot:"#EF9F27",col:"#EF9F27"},
                          {value:"NORMAL",label:"NORMAL",dot:"#639922",col:"#639922"},
                        ].map(opt => {
                          const count = opt.value ? brs.filter(b=>b.borrow_alert===opt.value).length : brs.length;
                          const active = brFilter === opt.value;
                          return (
                            <div key={opt.value} onClick={()=>{setBrFilter(opt.value);setBrFilterOpen(false);}}
                              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",
                                background:active?(dark?"#2a2a2a":"#f5f5f3"):"transparent",
                                fontSize:12,fontWeight:active?600:400,color:opt.col}}
                            >
                              <span style={{width:7,height:7,borderRadius:"50%",background:opt.dot,flexShrink:0}}/>
                              <span style={{flex:1}}>{opt.label}</span>
                              <span style={{fontSize:10,color:dark?"#555":"#bbb"}}>{count}</span>
                              {active && <svg width={10} height={8} viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke={opt.dot} strokeWidth="1.5" strokeLinecap="round"/></svg>}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── BR Search ── */}
          {!loading && brs.length > 0 && (
            <div style={{padding:"8px 16px", borderBottom:`0.5px solid ${bdr}`, flexShrink:0}}>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",fontSize:12,color:"#555",pointerEvents:"none"}}>🔍</span>
                <input
                  value={brSearch}
                  onChange={e => setBrSearch(e.target.value)}
                  placeholder="ค้นหาเลข BR..."
                  style={{
                    width:"100%", padding:"6px 10px 6px 30px", fontSize:12,
                    border:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.15)"}`,
                    borderRadius:7, outline:"none",
                    background:dark?"#111":"#f9f9f7",
                    color:dark?"#ddd":"#111",
                  }}
                />
              </div>
              {(brSearch || brFilter) && (
                <div style={{fontSize:10,color:"#555",marginTop:4}}>
                  แสดง <span style={{color:"#D4357A",fontWeight:600}}>{filteredBrs.length}</span> รายการ จาก {brs.length} BR
                  {brFilter && <span> · กรอง: <span style={{color:brFilter==="BLOCK"?"#E24B4A":brFilter==="WARNING"?"#EF9F27":"#639922",fontWeight:600}}>{brFilter}</span></span>}
                </div>
              )}
            </div>
          )}

          <div style={{flex:1,overflowY:"auto"}}>
            {loading ? (
              <div style={{padding:"32px",textAlign:"center",fontSize:12,color:"#aaa"}}>{t.brLoading}</div>
            ) : filteredBrs.length === 0 ? (
              <div style={{padding:"32px",textAlign:"center",fontSize:12,color:"#aaa"}}>
                {brSearch || brFilter ? "ไม่พบ BR ที่ตรงกัน" : t.noBR}
              </div>
            ) : filteredBrs.map(br => {
              const items = br.items || [];
              const total = items.reduce((s,i) => s+(Number(i.price)||0)*(Number(i.quantity)||0), 0);
              const isChk = selected.has(br.borrow_no);
              return (
                <div key={br.borrow_no} style={{padding:"11px 16px",borderBottom:`0.5px solid ${bdr}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,
                  background:isChk?(dark?"#2D1020":"#FFF0F5"):br.borrow_alert==="BLOCK"?(dark?"#1e0e0e":"transparent"):br.borrow_alert==="WARNING"?(dark?"#1e1600":"transparent"):"transparent"}}>
                  {/* Checkbox */}
                  <div
                    onClick={() => toggleOne(br.borrow_no)}
                    style={{width:15,height:15,borderRadius:3,border:`1.5px solid ${isChk?"#D4357A":dark?"#444":"#bbb"}`,background:isChk?"#D4357A":"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}
                  >
                    {isChk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                      <span style={{fontSize:12,fontWeight:600,color:txt}}>{br.borrow_no}</span>
                      <span style={{fontSize:11,color:"#888"}}>{br.borrow_date}</span>
                      {badge(br.borrow_alert, dark)}
                    </div>
                    <div style={{fontSize:11,color:"#888"}}>
                      <span style={{color:br.days_borrowed>180?(dark?"#F09595":"#A32D2D"):br.days_borrowed>90?(dark?"#FAC775":"#854F0B"):"#888",fontWeight:br.days_borrowed>90?600:400}}>
                        {br.days_borrowed} วัน
                      </span>
                      {" · "}{items.length} รายการสินค้า{" · "}
                      <span style={{color:dark?"#aaa":"#333",fontWeight:500}}>{total.toLocaleString()} บาท</span>
                    </div>
                  </div>
                  <button style={{...S.btnBlue,flexShrink:0}} onClick={()=>setSelectedBr(br)}>{t.detail}</button>
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
      {selectedBr && <BRDetailModal br={selectedBr} onClose={() => setSelectedBr(null)} dark={dark} t={t}/>}
    </>
  );
}

export default function SaleView({ customers, dark, custValues = {}, analytics, lang = "th" }) {
  const [search, setSearch]           = useState("");
  const [saleFilter, setSaleFilter]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const t = T[lang];
  const S = getS(dark);
  const allSales = [...new Set(customers.map(c => c.sale))].sort();

  const filtered = customers.filter(c =>
    (!search ||
      c.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      c.cust_code.toLowerCase().includes(search.toLowerCase()) ||
      (c.address || "").toLowerCase().includes(search.toLowerCase())
    ) &&
    (!saleFilter || c.sale === saleFilter) &&
    (!statusFilter || c.status === statusFilter)
  ).sort((a,b) => b.max_days - a.max_days);

  const bl = filtered.filter(c => c.status==="BLOCK").length;
  const wa = filtered.filter(c => c.status==="WARNING").length;

  const rowBg = s => s==="BLOCK"?(dark?"#1e0e0e":"#FDF0F0"):s==="WARNING"?(dark?"#1e1600":"#FDF6E8"):"transparent";

  const myTeam = saleFilter ? (() => {
    const TEAMS = {
      Bangkok:["TANG","OPAL","PAT","GAM","SHIRLEY","NAMPHUENG","CHOMPOO","RUNG"],
      North:["ICE","MAI","PLU"], "North-East":["JONG","NING","HONGFAH","WHAN"],
      East:["EVE","MAMAEW","BEN"], South:["MOD"], Office:["NEO BIOTECH"],
    };
    for (const [t, sales] of Object.entries(TEAMS)) if (sales.includes(saleFilter)) return t;
    return null;
  })() : null;

  const filteredValue = filtered.reduce((sum, c) => sum + (custValues[c.cust_code] || 0), 0);
  const fmtVal = (v) => v >= 1000000 ? `฿ ${(v/1000000).toFixed(1)}M` : `฿ ${Math.round(v).toLocaleString()}`;
  const inp = { padding:"7px 10px", fontSize:12, border:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.15)"}`, borderRadius:8, outline:"none", background:dark?"#1a1a1a":"#fff", color:dark?"#ddd":"#111" };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 50px)"}}>
      {/* Fixed top section */}
      <div style={{flexShrink:0}}>
        {bl > 0 && (
          <div style={{background:dark?"#2D1010":"#FCEBEB",border:`0.5px solid ${dark?"#7A2020":"#F09595"}`,borderRadius:8,padding:"9px 14px",marginBottom:10,fontSize:12,color:dark?"#F09595":"#791F1F",display:"flex",gap:6,flexWrap:"wrap"}}>
            <strong>แจ้งเตือน:</strong> {t.alertMsg(bl)}
          </div>
        )}

        {/* KPI */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:10}}>
          <div style={{background:dark?"#1a1a1a":"var(--color-background-primary)",border:`1.5px solid ${dark?"#2a2a2a":"var(--color-border-secondary)"}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:dark?"#ddd":"#888",marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.totalCustomers}</div>
            <div style={{fontSize:20,fontWeight:600,color:dark?"#eee":"var(--color-text-primary)"}}>{filtered.length}</div>
          </div>
          <div style={{background:dark?"#2D1010":"#FCEBEB",border:`1.5px solid ${dark?"#7A2020":"#F09595"}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:dark?"#F09595":"#A32D2D",marginBottom:3,fontWeight:500}}>BLOCK</div>
            <div style={{fontSize:20,fontWeight:600,color:dark?"#F09595":"#A32D2D"}}>{bl}</div>
          </div>
          <div style={{background:dark?"#2D1E00":"#FAEEDA",border:`1.5px solid ${dark?"#7A5500":"#FAC775"}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:dark?"#FAC775":"#854F0B",marginBottom:3,fontWeight:500}}>WARNING</div>
            <div style={{fontSize:20,fontWeight:600,color:dark?"#FAC775":"#854F0B"}}>{wa}</div>
          </div>
          <div style={{background:dark?"#162010":"#EAF3DE",border:`1.5px solid ${dark?"#3A6014":"#C0DD97"}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:dark?"#C0DD97":"#3B6D11",marginBottom:3,fontWeight:500}}>NORMAL</div>
            <div style={{fontSize:20,fontWeight:600,color:dark?"#C0DD97":"#3B6D11"}}>{filtered.length-bl-wa}</div>
          </div>
          <div style={{background:dark?"#1a1a1a":"var(--color-background-primary)",border:`1.5px solid ${dark?"#2a2a2a":"var(--color-border-secondary)"}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:dark?"#ddd":"#888",marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.brActive}</div>
            <div style={{fontSize:20,fontWeight:600,color:dark?"#eee":"var(--color-text-primary)"}}>{filtered.reduce((s,c)=>s+c.active_br_count,0).toLocaleString()}</div>
          </div>
          <div style={{background:dark?"#1a1a1a":"var(--color-background-primary)",border:`1.5px solid ${dark?"#7A2020":"#F09595"}`,borderRadius:10,padding:"10px 12px",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:10,color:dark?"#F09595":"#A32D2D",marginBottom:3,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.totalValue}</div>
              <div style={{fontSize:18,fontWeight:600,color:dark?"#F09595":"#A32D2D"}}>{fmtVal(filteredValue)}</div>
            </div>
            {myTeam && <span style={{fontSize:9,fontWeight:500,color:"#185FA5",background:dark?"#0C2A4A":"#E6F1FB",border:"0.5px solid #185FA5",borderRadius:4,padding:"1px 6px",alignSelf:"flex-start",marginTop:3}}>ทีม {myTeam}</span>}
          </div>
        </div>

        {/* Filters */}
        <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t.search} style={{...inp,width:"calc(100% / 6 * 2)",maxWidth:320,minWidth:160,outline:"none"}}/>
          <select value={saleFilter} onChange={e=>setSaleFilter(e.target.value)} style={{...inp,width:130,flexShrink:0}}>
            <option value="">{t.allSale}</option>
            {allSales.map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{...inp,width:120,flexShrink:0}}>
            <option value="">{t.allStatus}</option>
            <option>BLOCK</option><option>WARNING</option><option>NORMAL</option>
          </select>
        </div>
      </div>

      {/* Scrollable table */}
      <div style={{flex:1,overflow:"auto",background:dark?"#141414":"#fff",border:`0.5px solid ${dark?"#222":"rgba(0,0,0,0.1)"}`,borderRadius:10}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:580}}>
          <thead>
            <tr style={{position:"sticky",top:0,zIndex:10,background:dark?"#1a1a1a":"#f9f9f7"}}>
              {["#",t.custCode,t.custName,t.address,"Sale",t.br,t.daysOverdue,t.value,t.status,""].map((h,i)=>(
                <th key={i} style={{padding:"8px 10px",textAlign:"left",fontSize:11,fontWeight:500,color:dark?"#ddd":"#888",
                  borderBottom:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.08)"}`,
                  width:i===0?"28px":i===1?"75px":i===2?"180px":i===4?"65px":i===5?"38px":i===6?"85px":i===7?"95px":i===8?"80px":i===9?"85px":"auto"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{padding:"32px",textAlign:"center",fontSize:12,color:"#888"}}>{t.noCustomer}</td></tr>
            ) : filtered.map((c,i)=>(
              <tr key={c.cust_code} style={{background:rowBg(c.status),borderBottom:`0.5px solid ${dark?"#1e1e1e":"rgba(0,0,0,0.06)"}`}}>
                <td style={{padding:"9px 10px",fontSize:11,color:"#ddd"}}>{i+1}</td>
                <td style={{padding:"9px 10px",fontSize:11,fontWeight:500,color:dark?"#ddd":"#555",fontFamily:"monospace"}}>{c.cust_code}</td>
                <td style={{padding:"9px 10px",fontSize:12,fontWeight:500,color:dark?"#ddd":"#111"}}>{c.customer_name}</td>
                <td style={{padding:"9px 10px",fontSize:11,color:dark?"#ddd":"#111",maxWidth:0}}>
                  {c.address ? (
                    <div style={{display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",lineHeight:1.5}}>{c.address}</div>
                  ) : <span style={{color:dark?"#333":"#ccc"}}>—</span>}
                </td>
                <td style={{padding:"9px 10px",fontSize:11,color:dark?"#ddd":"#777"}}>{c.sale}</td>
                <td style={{padding:"9px 10px",fontSize:11,color:dark?"#ddd":"#777"}}>{c.active_br_count}</td>
                <td style={{padding:"9px 10px",fontSize:12,fontWeight:c.max_days>90?500:400,
                  color:c.max_days>180?(dark?"#F09595":"#A32D2D"):c.max_days>90?(dark?"#FAC775":"#854F0B"):(dark?"#ddd":"#1a1a1a")}}>{c.max_days} วัน</td>
                <td style={{padding:"9px 10px",fontSize:11,fontWeight:500,
                  color:c.max_days>180?(dark?"#F09595":"#A32D2D"):c.max_days>90?(dark?"#FAC775":"#854F0B"):(dark?"#ddd":"#888")}}>
                  {custValues[c.cust_code] ? fmtVal(custValues[c.cust_code]) : "—"}
                </td>
                <td style={{padding:"9px 10px"}}><StatusBadge status={c.status}/></td>
                <td style={{padding:"9px 10px"}}>
                  <button style={S.btnBlue} onClick={()=>setSelectedCustomer(c)}>{t.detail}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCustomer && (
        <CustomerModal customer={selectedCustomer} onClose={()=>setSelectedCustomer(null)} dark={dark} t={t}/>
      )}
    </div>
  );
}
