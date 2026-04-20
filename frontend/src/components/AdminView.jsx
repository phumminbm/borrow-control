import { useState, useEffect, useRef } from "react";
import { TEAMS, TEAM_COLORS, SC, StatusBadge } from "../App";

// lookup team จาก sale name
function getTeam(sale) {
  for (const [team, sales] of Object.entries(TEAMS)) {
    if (sales.includes(sale)) return team;
  }
  return "Office";
}

// ── Mini Donut (SVG) ──────────────────────────────────────────────
function Donut({ bl, wa, no, size=110 }) {
  const total = bl + wa + no || 1;
  const r = 38, cx = 55, cy = 55, stroke = 11;
  const circ = 2 * Math.PI * r;
  function arc(val, offset) {
    return { strokeDasharray:`${(val/total)*circ} ${circ}`, strokeDashoffset:-(offset/total)*circ };
  }
  return (
    <svg width={size} height={size} viewBox="0 0 110 110" style={{transform:"rotate(-90deg)"}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={stroke}/>
      {no>0&&<circle cx={cx} cy={cy} r={r} fill="none" stroke="#97C459" strokeWidth={stroke} {...arc(no,bl+wa)} strokeLinecap="round"/>}
      {wa>0&&<circle cx={cx} cy={cy} r={r} fill="none" stroke="#EF9F27" strokeWidth={stroke} {...arc(wa,bl)} strokeLinecap="round"/>}
      {bl>0&&<circle cx={cx} cy={cy} r={r} fill="none" stroke="#E24B4A" strokeWidth={stroke} {...arc(bl,0)} strokeLinecap="round"/>}
    </svg>
  );
}

// ── Bar chart (canvas) ────────────────────────────────────────────
function BarChart({ team, customers }) {
  const ref = useRef();
  useEffect(() => {
    if (!team || !ref.current) return;
    const sales = TEAMS[team];
    const canvas = ref.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth, H = 160;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const stats = sales.map(sale => {
      const cs = customers.filter(c => getTeam(c.sale)===team && c.sale===sale);
      return { sale, bl:cs.filter(c=>c.status==="BLOCK").length, wa:cs.filter(c=>c.status==="WARNING").length, no:cs.filter(c=>c.status==="NORMAL").length };
    });

    const maxVal = Math.max(...stats.map(s=>s.bl+s.wa+s.no), 1);
    const pad = {top:10,right:10,bottom:28,left:28};
    const chartW = W-pad.left-pad.right;
    const chartH = H-pad.top-pad.bottom;
    const barW = Math.min(28, chartW/sales.length-6);

    ctx.clearRect(0,0,W,H);
    for (let i=0;i<=4;i++) {
      const y = pad.top+chartH*(1-i/4);
      ctx.strokeStyle="rgba(0,0,0,0.06)"; ctx.lineWidth=0.5;
      ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
      ctx.fillStyle="#bbb"; ctx.font="9px sans-serif"; ctx.textAlign="right";
      ctx.fillText(Math.round(maxVal*i/4), pad.left-4, y+3);
    }
    stats.forEach((s,i) => {
      const x = pad.left+(chartW/sales.length)*i+(chartW/sales.length-barW)/2;
      const total = s.bl+s.wa+s.no;
      let yBottom = pad.top+chartH;
      [["no","#97C459"],["wa","#EF9F27"],["bl","#E24B4A"]].forEach(([k,color])=>{
        const h=(s[k]/maxVal)*chartH;
        if(h>0){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,yBottom-h,barW,h,k==="bl"?[3,3,0,0]:[0,0,0,0]);ctx.fill();yBottom-=h;}
      });
      ctx.fillStyle="#aaa"; ctx.font="9px sans-serif"; ctx.textAlign="center";
      ctx.fillText(s.sale.length>6?s.sale.slice(0,6)+"…":s.sale, x+barW/2, H-pad.bottom+12);
      if(total>0){ctx.fillStyle="#666";ctx.font="bold 9px sans-serif";ctx.fillText(total,x+barW/2,pad.top+chartH-(total/maxVal)*chartH-4);}
    });
  }, [team, customers]);
  return <canvas ref={ref} style={{width:"100%",height:160,display:"block"}}/>;
}

export default function AdminView({ customers, syncLogs, dark, analytics }) {
  const [selTeam, setSelTeam]       = useState(null);
  const [search, setSearch]         = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [saleFilter, setSaleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // เพิ่ม team field ให้ทุก customer จาก TEAMS mapping
  const customersWithTeam = customers.map(c => ({
    ...c, team: getTeam(c.sale)
  }));

  const allSales = teamFilter
    ? TEAMS[teamFilter]
    : Object.values(TEAMS).flat();

  const filtered = customersWithTeam.filter(c =>
    (!search ||
      c.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      String(c.cust_code).toLowerCase().includes(search.toLowerCase())
    ) &&
    (!teamFilter || c.team===teamFilter) &&
    (!saleFilter || c.sale===saleFilter) &&
    (!statusFilter || c.status===statusFilter)
  ).sort((a,b) => b.max_days - a.max_days);

  const totalBl  = customersWithTeam.filter(c=>c.status==="BLOCK").length;
  const totalWa  = customersWithTeam.filter(c=>c.status==="WARNING").length;
  const totalNo  = customersWithTeam.filter(c=>c.status==="NORMAL").length;
  const totalBR  = customersWithTeam.reduce((s,c)=>s+c.active_br_count,0);

  const lastSync = syncLogs[0];
    const cs = selTeam ? customersWithTeam.filter(c=>c.team===selTeam) : customersWithTeam;
    return { bl:cs.filter(c=>c.status==="BLOCK").length, wa:cs.filter(c=>c.status==="WARNING").length, no:cs.filter(c=>c.status==="NORMAL").length, total:cs.length };
  })();

  const top5 = analytics?.top5 || [];
  const saleRanking = analytics?.sale_ranking || [];
  const totalValue = analytics?.total_value || 0;
  const fmtVal = (v) => v >= 1000000 ? `฿ ${(v/1000000).toFixed(1)}M` : `฿ ${Math.round(v).toLocaleString()}`;

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["ลูกค้าทั้งหมด",customersWithTeam.length,null],["BLOCK",totalBl,"#A32D2D"],["WARNING",totalWa,"#854F0B"],["NORMAL",totalNo,"#3B6D11"],["BR active",totalBR,null]].map(([l,v,c])=>(
          <div key={l} style={{background:"#f5f5f3",borderRadius:8,padding:"9px 14px",flex:1,minWidth:80}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>{l}</div>
            <div style={{fontSize:19,fontWeight:600,color:c||"#1a1a1a"}}>{typeof v==="number"?v.toLocaleString():v}</div>
          </div>
        ))}
        <div style={{background:"#f5f5f3",borderRadius:8,padding:"9px 14px",flex:1,minWidth:120}}>
          <div style={{fontSize:11,color:"#888",marginBottom:2}}>มูลค่าค้างรวม</div>
          <div style={{fontSize:17,fontWeight:600,color:"#A32D2D"}}>{fmtVal(totalValue)}</div>
        </div>
      </div>

      {/* Sync status */}
      {lastSync && (
        <div style={{background:"#f9f9f7",border:"0.5px solid rgba(0,0,0,0.08)",borderRadius:8,padding:"8px 14px",marginBottom:14,fontSize:11,color:"#888",display:"flex",flexWrap:"wrap",gap:12,alignItems:"center"}}>
          <span><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:lastSync.status==="success"?"#639922":"#EF9F27",marginRight:5}}/><strong style={{color:"#555"}}>Sync ล่าสุด:</strong> {lastSync.synced_at}</span>
          <span>Sheet {lastSync.sheet_rows?.toLocaleString()} แถว</span>
          <span style={{color:"#185FA5"}}>+{lastSync.br_inserted} ใหม่</span>
          <span>~{lastSync.br_updated} เปลี่ยน</span>
          <span>-{lastSync.br_closed} ปิด</span>
          <span style={{color:lastSync.errors>0?"#A32D2D":"#639922"}}>{lastSync.errors} error</span>
          <span>{(lastSync.duration_ms/1000).toFixed(1)}s</span>
        </div>
      )}

      {/* Charts */}
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1.7fr)",gap:12,marginBottom:14}}>
        {/* Pie */}
        <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,padding:14}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:10,color:"#555"}}>
            {selTeam?`สัดส่วน — ${selTeam}`:"สัดส่วนรวมทุกทีม"}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{position:"relative",flexShrink:0}}>
              <Donut bl={pieData.bl} wa={pieData.wa} no={pieData.no}/>
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:18,fontWeight:600}}>{pieData.total}</div>
                <div style={{fontSize:10,color:"#aaa"}}>ลูกค้า</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:12}}>
              {[["BLOCK","#E24B4A","#A32D2D",pieData.bl],["WARNING","#EF9F27","#854F0B",pieData.wa],["NORMAL","#97C459","#3B6D11",pieData.no]].map(([l,dot,txt,v])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{width:10,height:10,borderRadius:2,background:dot,flexShrink:0}}/>
                  <span style={{color:"#888",flex:1}}>{l}</span>
                  <strong style={{color:txt}}>{v}</strong>
                  <span style={{color:"#ccc",fontSize:10,minWidth:36,textAlign:"right"}}>{pieData.total?Math.round(v/pieData.total*100):0}%</span>
                </div>
              ))}
              <div style={{borderTop:"0.5px solid rgba(0,0,0,0.08)",paddingTop:6,display:"flex",justifyContent:"space-between"}}>
                <span style={{color:"#aaa",fontSize:11}}>รวม</span>
                <strong style={{fontSize:11}}>{pieData.total} ราย</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Bar */}
        <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,padding:14}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:10,color:"#555"}}>
            {selTeam?`Sale ทีม ${selTeam}`:"เลือกทีมเพื่อดูรายคน"}
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            {Object.keys(TEAMS).map(t=>(
              <button key={t} onClick={()=>{setSelTeam(selTeam===t?null:t);setTeamFilter(selTeam===t?"":t);setSaleFilter("");}} style={{
                padding:"4px 11px",fontSize:11,fontWeight:500,borderRadius:20,cursor:"pointer",border:"0.5px solid",
                background:selTeam===t?TEAM_COLORS[t]:"#fff",
                color:selTeam===t?"#fff":TEAM_COLORS[t],
                borderColor:TEAM_COLORS[t],transition:"all .15s",
              }}>{t}</button>
            ))}
            {selTeam&&<button onClick={()=>{setSelTeam(null);setTeamFilter("");setSaleFilter("");}} style={{padding:"4px 11px",fontSize:11,borderRadius:20,cursor:"pointer",border:"0.5px solid rgba(0,0,0,0.15)",background:"#fff",color:"#888"}}>ล้าง</button>}
          </div>
          {selTeam ? (
            <>
              <BarChart team={selTeam} customers={customersWithTeam}/>
              <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:6,fontSize:11}}>
                {[["#E24B4A","BLOCK"],["#EF9F27","WARNING"],["#97C459","NORMAL"]].map(([c,l])=>(
                  <span key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{width:10,height:10,borderRadius:2,background:c}}/><span style={{color:"#888"}}>{l}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{height:160,display:"flex",alignItems:"center",justifyContent:"center",color:"#bbb",fontSize:12}}>
              คลิกทีมด้านบนเพื่อดู Sale รายคน
            </div>
          )}
        </div>
      </div>

      {/* Top5 + Sale Ranking */}
      {(top5.length > 0 || saleRanking.length > 0) && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:12,marginBottom:14}}>
          {/* Top 5 */}
          <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,padding:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#555",marginBottom:10}}>Top 5 ค้างนานที่สุด</div>
            {top5.map((c, i) => (
              <div key={c.cust_code} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:i<4?"0.5px solid rgba(0,0,0,0.06)":"none"}}>
                <span style={{width:18,height:18,borderRadius:"50%",background:i<3?"#E24B4A":"#FAEEDA",color:i<3?"#fff":"#854F0B",fontSize:9,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</span>
                <span style={{flex:1,fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.customer_name}</span>
                <span style={{fontSize:11,color:"#A32D2D",fontWeight:500,flexShrink:0}}>{c.max_days.toLocaleString()} วัน</span>
              </div>
            ))}
          </div>

          {/* Sale Ranking */}
          <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,padding:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#555",marginBottom:10}}>สรุปตาม Sale — BLOCK / WARNING / มูลค่า</div>
            <div style={{display:"grid",gridTemplateColumns:"70px 1fr 36px 36px 80px",gap:4,fontSize:10,fontWeight:500,color:"#aaa",marginBottom:6,paddingBottom:4,borderBottom:"0.5px solid rgba(0,0,0,0.08)"}}>
              <span>Sale</span><span>สัดส่วน BLOCK</span><span style={{textAlign:"center"}}>BL</span><span style={{textAlign:"center"}}>WA</span><span style={{textAlign:"right"}}>มูลค่า</span>
            </div>
            {saleRanking.slice(0,7).map(s => {
              const maxBl = Math.max(...saleRanking.map(r => r.block_count), 1);
              const pct = Math.round((s.block_count / maxBl) * 100);
              return (
                <div key={s.sale} style={{display:"grid",gridTemplateColumns:"70px 1fr 36px 36px 80px",gap:4,alignItems:"center",padding:"5px 0",borderBottom:"0.5px solid rgba(0,0,0,0.04)",fontSize:11}}>
                  <span style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.sale}</span>
                  <div style={{background:"rgba(0,0,0,0.06)",borderRadius:4,height:6}}>
                    <div style={{background: s.block_count > 0 ? "#E24B4A" : "#EF9F27",borderRadius:4,height:6,width:`${pct}%`}}/>
                  </div>
                  <span style={{textAlign:"center",color:"#A32D2D",fontWeight:500}}>{s.block_count||"—"}</span>
                  <span style={{textAlign:"center",color:"#854F0B"}}>{s.warn_count||"—"}</span>
                  <span style={{textAlign:"right",fontSize:10,color:"#888"}}>{fmtVal(s.total_value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table filters */}
      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหารหัสหรือชื่อลูกค้า..."
          style={{flex:1,minWidth:180,maxWidth:240,padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,outline:"none"}}/>
        <select value={teamFilter} onChange={e=>{setTeamFilter(e.target.value);setSelTeam(e.target.value||null);setSaleFilter("");}}
          style={{padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,background:"#fff"}}>
          <option value="">ทุกทีม</option>
          {Object.keys(TEAMS).map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={saleFilter} onChange={e=>setSaleFilter(e.target.value)}
          style={{padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,background:"#fff",minWidth:120}}>
          <option value="">ทุก Sale</option>
          {[...new Set(allSales)].map(s=><option key={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{padding:"7px 10px",fontSize:12,border:"0.5px solid rgba(0,0,0,0.15)",borderRadius:8,background:"#fff"}}>
          <option value="">ทุกสถานะ</option>
          <option>BLOCK</option><option>WARNING</option><option>NORMAL</option>
        </select>
      </div>

      {/* Full table */}
      <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,overflow:"hidden",marginBottom:14}}>
        <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
          <thead style={{background:"#f9f9f7",borderBottom:"0.5px solid rgba(0,0,0,0.08)"}}>
            <tr>
              {["#","รหัสลูกค้า","ชื่อลูกค้า","ทีม","Sale","BR","วันค้าง","สถานะ","อัปเดต"].map((h,i)=>(
                <th key={h} style={{padding:"8px 11px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888",
                  width:i===0?"28px":i===1?"85px":i===3?"80px":i===4?"80px":i===5?"45px":i===6?"80px":i===7?"85px":i===8?"70px":"auto"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0,15).map((c,i)=>{
              const bg=c.status==="BLOCK"?"rgba(252,235,235,0.25)":c.status==="WARNING"?"rgba(250,238,218,0.25)":"transparent";
              const tc=TEAM_COLORS[c.team]||"#888";
              return (
                <tr key={c.cust_code} style={{background:bg,borderBottom:"0.5px solid rgba(0,0,0,0.05)"}}>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#bbb"}}>{i+1}</td>
                  <td style={{padding:"7px 11px",fontSize:11,fontWeight:500,color:"#555",fontFamily:"monospace"}}>{c.cust_code}</td>
                  <td style={{padding:"7px 11px",fontSize:11,fontWeight:500}}>{c.customer_name}</td>
                  <td style={{padding:"7px 11px"}}>
                    <span style={{fontSize:10,fontWeight:500,color:tc,background:tc+"18",border:`0.5px solid ${tc}44`,borderRadius:4,padding:"1px 6px"}}>{c.team}</span>
                  </td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#777"}}>{c.sale}</td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#aaa"}}>{c.active_br_count}</td>
                  <td style={{padding:"7px 11px",fontSize:11,fontWeight:c.max_days>90?500:400,color:c.max_days>180?"#A32D2D":c.max_days>90?"#854F0B":"#1a1a1a"}}>{c.max_days} วัน</td>
                  <td style={{padding:"7px 11px"}}><StatusBadge status={c.status}/></td>
                  <td style={{padding:"7px 11px",fontSize:10,color:"#bbb"}}>{c.updated_at ? new Date(c.updated_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}) : "—"}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={9} style={{padding:"8px",textAlign:"center",fontSize:11,color:"#aaa"}}>
                แสดง {Math.min(15,filtered.length)} จาก {filtered.length} รายการ
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sync log */}
      <div style={{fontSize:12,fontWeight:600,color:"#555",marginBottom:8}}>Sync log</div>
      <div style={{background:"#fff",border:"0.5px solid rgba(0,0,0,0.1)",borderRadius:10,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
          <thead style={{background:"#f9f9f7"}}>
            <tr>
              {["เวลา","สถานะ","ใหม่","เปลี่ยน","ปิด","error","เวลา(s)","หมายเหตุ"].map(h=>(
                <th key={h} style={{padding:"7px 11px",textAlign:"left",fontSize:11,fontWeight:500,color:"#888"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {syncLogs.map((l,i)=>{
              const sc=l.status==="success"?{bg:"#EAF3DE",txt:"#3B6D11",bd:"#C0DD97",label:"สำเร็จ"}
                      :l.status==="partial"?{bg:"#FAEEDA",txt:"#854F0B",bd:"#FAC775",label:"บางส่วน"}
                      :{bg:"#FCEBEB",txt:"#A32D2D",bd:"#F09595",label:"ล้มเหลว"};
              return (
                <tr key={i} style={{borderBottom:"0.5px solid rgba(0,0,0,0.05)"}}>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#aaa"}}>{l.synced_at ? new Date(l.synced_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—"}</td>
                  <td style={{padding:"7px 11px"}}><span style={{display:"inline-flex",alignItems:"center",gap:4,background:sc.bg,color:sc.txt,border:`0.5px solid ${sc.bd}`,borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:500}}>{sc.label}</span></td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#185FA5"}}>{l.br_inserted>0?"+"+l.br_inserted:"—"}</td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#888"}}>{l.br_updated||"—"}</td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#888"}}>{l.br_closed>0?"-"+l.br_closed:"—"}</td>
                  <td style={{padding:"7px 11px",fontSize:11,color:l.errors>0?"#A32D2D":"#bbb"}}>{l.errors||"—"}</td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#aaa"}}>{(l.duration_ms/1000).toFixed(1)}</td>
                  <td style={{padding:"7px 11px",fontSize:11,color:"#A32D2D"}}>{l.error_msg||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}