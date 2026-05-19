import { useState, useEffect, useRef } from "react";
import { TEAMS, TEAM_COLORS, SC, StatusBadge, T } from "../../App";

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

export default function AdminView({ customers, syncLogs, syncHealth, dark, analytics, custValues = {}, lang = "th" }) {
  const t = T[lang];
  const [selTeam, setSelTeam]       = useState(null);
  const [search, setSearch]         = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [saleFilter, setSaleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const customersWithTeam = customers.map(c => ({ ...c, team: getTeam(c.sale) }));

  const allSales = teamFilter ? TEAMS[teamFilter] : Object.values(TEAMS).flat();

  // ── filtered customers (ใช้กับ KPI, Donut, Top5, Sale ranking, ตาราง) ──
  const filtered = customersWithTeam.filter(c =>
    (!search ||
      c.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      String(c.cust_code).toLowerCase().includes(search.toLowerCase())
    ) &&
    (!teamFilter || c.team===teamFilter) &&
    (!saleFilter || c.sale===saleFilter) &&
    (!statusFilter || c.status===statusFilter)
  ).sort((a,b) => b.max_days - a.max_days);

  // ── KPI ตาม filter ──
  const filteredBl = filtered.filter(c=>c.status==="BLOCK").length;
  const filteredWa = filtered.filter(c=>c.status==="WARNING").length;
  const filteredNo = filtered.filter(c=>c.status==="NORMAL").length;
  const filteredBR = filtered.reduce((s,c)=>s+c.active_br_count, 0);

  // ── Donut ตาม filter ──
  const pieData = { bl:filteredBl, wa:filteredWa, no:filteredNo, total:filtered.length };

  // ── Top 5 ตาม filter ──
  const filteredTop5 = [...filtered]
    .filter(c => c.status==="BLOCK" || c.status==="WARNING")
    .sort((a,b) => b.max_days - a.max_days)
    .slice(0, 5);

  // ── {t.top10Value} ──
  const top10ByValue = [...filtered]
    .filter(c => analytics?.customer_value?.[c.cust_code] || custValues?.[c.cust_code])
    .sort((a,b) => {
      const va = analytics?.customer_value?.[b.cust_code] || 0;
      const vb = analytics?.customer_value?.[a.cust_code] || 0;
      return va - vb;
    })
    .slice(0, 10)
    .map(c => ({...c, value: analytics?.customer_value?.[c.cust_code] || 0}));

  // ── Sale ranking ตาม filter ──
  const saleScope = saleFilter
    ? [saleFilter]
    : teamFilter ? TEAMS[teamFilter] : Object.values(TEAMS).flat();

  const filteredSaleRanking = saleScope.map(sale => {
    const cs = filtered.filter(c => c.sale === sale);
    const value = (analytics?.sale_value?.[sale]) || 0;
    return {
      sale,
      block_count: cs.filter(c=>c.status==="BLOCK").length,
      warn_count:  cs.filter(c=>c.status==="WARNING").length,
      normal_count:cs.filter(c=>c.status==="NORMAL").length,
      total_value: value,
    };
  }).filter(s => s.block_count + s.warn_count + s.normal_count > 0)
    .sort((a,b) => b.block_count - a.block_count);

  // ── มูลค่ารวมตาม filter ──
  // When no team/sale filter is active, use the backend's exact total_value.
  // sale_value is keyed by sale name and doesn't include rows whose sale field
  // is blank, so summing over saleScope (built from the TEAMS mapping) silently
  // dropped customers with no sale assigned. Falling back to total_value when
  // there's no filter keeps the unfiltered KPI byte-for-byte consistent with
  // the Sheet. Filtered views still sum sale_value so per-team/per-sale slicing
  // is unchanged.
  const filteredValue = (saleFilter || teamFilter)
    ? saleScope.reduce((sum, sale) => sum + (analytics?.sale_value?.[sale] || 0), 0)
    : (analytics?.total_value || 0);

  const lastSync = syncLogs[0];
  const fmtVal = (v) => v >= 1000000 ? `฿ ${(v/1000000).toFixed(1)}M` : `฿ ${Math.round(v).toLocaleString()}`;


  // ── Head-to-Head ──
  const allSaleNames = [...new Set(customersWithTeam.map(c=>c.sale))].sort();
  const [h2hA, setH2hA] = useState("");
  const [h2hB, setH2hB] = useState("");
  const h2hStats = (sale) => {
    const cs = filtered.filter(c=>c.sale===sale);
    return {
      total:  cs.length,
      block:  cs.filter(c=>c.status==="BLOCK").length,
      warn:   cs.filter(c=>c.status==="WARNING").length,
      normal: cs.filter(c=>c.status==="NORMAL").length,
      value:  analytics?.sale_value?.[sale]||0,
      maxDays: cs.length ? Math.max(...cs.map(c=>c.max_days)) : 0,
    };
  };
  const da = h2hA ? h2hStats(h2hA) : null;
  const db2 = h2hB ? h2hStats(h2hB) : null;

  const cardStyle = {background:dark?"#141414":"#fff",border:`0.5px solid ${dark?"#222":"rgba(0,0,0,0.1)"}`,borderRadius:10,padding:14};

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100%",padding:"22px 28px 40px"}}>

      {/* ── FIXED TOP ── */}
      <div>

        {/* Team chip filter row (mockup-styled) + search/select cluster */}
        <div className="v2-team-chip-row" style={{justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",flex:1}}>
            <button
              type="button"
              className={"v2-team-chip" + (teamFilter ? "" : " active")}
              style={{
                background: teamFilter ? "transparent" : "var(--v2-text)",
                color: teamFilter ? "var(--v2-sub)" : "var(--v2-bg)",
                borderColor: teamFilter ? "var(--v2-border2)" : "var(--v2-text)",
              }}
              onClick={()=>{setTeamFilter("");setSelTeam(null);setSaleFilter("");}}
            >{t.allTeams}</button>
            {Object.keys(TEAMS).map(tm=>(
              <button
                type="button"
                key={tm}
                className={"v2-team-chip" + (teamFilter===tm ? " active" : "")}
                style={{
                  borderColor: TEAM_COLORS[tm],
                  background: teamFilter===tm ? TEAM_COLORS[tm] : "transparent",
                  color: teamFilter===tm ? "#fff" : TEAM_COLORS[tm],
                }}
                onClick={()=>{setTeamFilter(tm===teamFilter?"":tm);setSelTeam(tm===teamFilter?null:tm);setSaleFilter("");}}
              >{tm}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
            <select className="v2-filter-sel" value={saleFilter} onChange={e=>setSaleFilter(e.target.value)} style={{minWidth:130}}>
              <option value="">ทุก Sale</option>
              {[...new Set(allSales)].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <select className="v2-filter-sel" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{minWidth:120}}>
              <option value="">ทุกสถานะ</option>
              <option>BLOCK</option><option>WARNING</option><option>NORMAL</option>
            </select>
            <div className="v2-search-input" style={{minWidth:180}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาลูกค้า..."/>
            </div>
          </div>
        </div>

        {/* KPI strip (mockup-styled, 6 cards) */}
        <div className="v2-kpi-grid cols-6">
          <div className="v2-kpi" onClick={() => setStatusFilter("")}>
            <div className="v2-kpi-icon blue">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            </div>
            <div className="v2-kpi-label">{t.totalCustomers}</div>
            <div className="v2-kpi-val">{filtered.length.toLocaleString()}</div>
          </div>
          <div className={"v2-kpi" + (statusFilter==="BLOCK" ? " sel" : "")} onClick={() => setStatusFilter(statusFilter==="BLOCK" ? "" : "BLOCK")}>
            <div className="v2-kpi-icon red">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <div className="v2-kpi-label">BLOCK</div>
            <div className="v2-kpi-val red">{filteredBl.toLocaleString()}</div>
          </div>
          <div className={"v2-kpi" + (statusFilter==="WARNING" ? " sel" : "")} onClick={() => setStatusFilter(statusFilter==="WARNING" ? "" : "WARNING")}>
            <div className="v2-kpi-icon yellow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
            </div>
            <div className="v2-kpi-label">WARNING</div>
            <div className="v2-kpi-val yellow">{filteredWa.toLocaleString()}</div>
          </div>
          <div className={"v2-kpi" + (statusFilter==="NORMAL" ? " sel" : "")} onClick={() => setStatusFilter(statusFilter==="NORMAL" ? "" : "NORMAL")}>
            <div className="v2-kpi-icon green">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div className="v2-kpi-label">NORMAL</div>
            <div className="v2-kpi-val green">{filteredNo.toLocaleString()}</div>
          </div>
          <div className="v2-kpi">
            <div className="v2-kpi-icon purple">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div className="v2-kpi-label">{t.brActive}</div>
            <div className="v2-kpi-val fs-22">{filteredBR.toLocaleString()}</div>
          </div>
          <div className="v2-kpi" title={`฿ ${Math.round(filteredValue).toLocaleString()}`} style={{cursor:"help"}}>
            <div className="v2-kpi-icon red">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div className="v2-kpi-label">{t.totalValue}</div>
            <div className="v2-kpi-val red fs-20">{fmtVal(filteredValue)}</div>
          </div>
        </div>

        {/* Sync bar (mockup-styled card-look) */}
        {syncHealth && syncHealth.status && (() => {
          const palette = {
            green:  "var(--v2-green)",
            yellow: "var(--v2-yellow)",
            red:    "var(--v2-red)",
          }[syncHealth.status] || "var(--v2-sub)";
          const hrs = syncHealth.hours_since_last_swap;
          const ago = hrs == null ? "—"
                    : hrs < 1 ? `${Math.round(hrs*60)} min ago`
                    : hrs < 48 ? `${hrs.toFixed(1)} h ago`
                    : `${Math.floor(hrs/24)} days ago`;
          return (
            <div style={{
              background:"var(--v2-card)", border:`1px solid var(--v2-border)`, borderLeft:`3px solid ${palette}`,
              borderRadius:8, padding:"10px 14px", marginBottom:12, fontSize:12,
              color:"var(--v2-text)", display:"flex",flexWrap:"wrap",gap:14,alignItems:"center",
            }}>
              <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:palette}}/>
              <strong>Snapshot:</strong>
              <span>last swap {ago}</span>
              <span style={{color:"var(--v2-sub)"}}>· {syncHealth.message}</span>
            </div>
          );
        })()}

        {lastSync && (
          <div style={{
            background:"var(--v2-card)", border:"1px solid var(--v2-border)",
            borderRadius:8, padding:"8px 14px", marginBottom:14, fontSize:11,
            color:"var(--v2-sub)", display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",
          }}>
            <span><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:lastSync.status==="success"?"var(--v2-green)":"var(--v2-yellow)",marginRight:5}}/><strong style={{color:"var(--v2-text)"}}>{t.syncLatest}:</strong> {lastSync.synced_at}</span>
            <span>Sheet {lastSync.sheet_rows?.toLocaleString()} {t.rows}</span>
            <span style={{color:"var(--v2-blue)"}}>+{lastSync.br_inserted} {t.new}</span>
            <span>~{lastSync.br_updated} {t.change}</span>
            <span>-{lastSync.br_closed} {t.close}</span>
            <span style={{color:lastSync.errors>0?"var(--v2-red)":"var(--v2-green)"}}>{lastSync.errors} error</span>
            <span>{(lastSync.duration_ms/1000).toFixed(1)}s</span>
          </div>
        )}
      </div>

      {/* ── SCROLLABLE CONTENT ── */}
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>

        {/* Row 1: Donut + Bar */}
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1.7fr)",gap:12}}>
          <div style={{...cardStyle,display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:10,color:dark?"#ddd":"#555",alignSelf:"flex-start"}}>
              {saleFilter?`${t.proportion} — ${saleFilter}`:teamFilter?`${t.proportion} — ${teamFilter}`:t.allTeamsProportion}
            </div>
            <div style={{position:"relative",width:140,height:140,flexShrink:0}}>
              <Donut bl={pieData.bl} wa={pieData.wa} no={pieData.no} size={140}/>
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:22,fontWeight:600,color:dark?"#eee":"#111"}}>{pieData.total}</div>
                <div style={{fontSize:10,color:"#888"}}>{t.customers}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:10,width:"100%"}}>
              {[["BLOCK","#2D1010","#7A2020","#F09595",pieData.bl],["WARNING","#2D1E00","#7A5500","#FAC775",pieData.wa],["NORMAL","#162010","#3A6014","#C0DD97",pieData.no]].map(([l,bg,bd,tx,v])=>(
                <div key={l} style={{background:dark?bg:"#f9f9f7",border:`0.5px solid ${dark?bd:"rgba(0,0,0,0.08)"}`,borderRadius:8,padding:"7px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:tx,marginBottom:2,fontWeight:500}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:600,color:tx}}>{v}</div>
                  <div style={{fontSize:9,color:dark?bd:"#aaa",marginTop:1}}>{pieData.total?Math.round(v/pieData.total*100):0}%</div>
                </div>
              ))}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:10,color:dark?"#ddd":"#555"}}>
              {selTeam?t.saleTeam(selTeam):t.selectTeam}
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
              {Object.keys(TEAMS).map(tm=>(
                <button key={tm} onClick={()=>{setSelTeam(selTeam===tm?null:tm);setTeamFilter(selTeam===tm?"":tm);setSaleFilter("");}} style={{
                  padding:"4px 11px",fontSize:11,fontWeight:500,borderRadius:20,cursor:"pointer",border:"0.5px solid",
                  background:selTeam===tm?TEAM_COLORS[tm]:dark?"#1a1a1a":"#fff",
                  color:selTeam===tm?"#fff":TEAM_COLORS[tm],borderColor:TEAM_COLORS[tm],transition:"all .15s",
                }}>{tm}</button>
              ))}
              {selTeam&&<button onClick={()=>{setSelTeam(null);setTeamFilter("");setSaleFilter("");}} style={{padding:"4px 11px",fontSize:11,borderRadius:20,cursor:"pointer",border:`0.5px solid ${dark?"#333":"rgba(0,0,0,0.15)"}`,background:dark?"#1a1a1a":"#fff",color:"#888"}}>{t.clear}</button>}
            </div>
            {selTeam?(
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
            ):(
              <div style={{height:160,display:"flex",alignItems:"center",justifyContent:"center",color:dark?"#333":"#bbb",fontSize:12}}>
                {t.selectTeam}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Top5 + Sale Ranking */}
        {(filteredTop5.length>0||filteredSaleRanking.length>0)&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:12}}>
            <div style={cardStyle}>
              <div style={{fontSize:12,fontWeight:600,color:dark?"#ddd":"#555",marginBottom:10}}>
                {t.top5Days}{teamFilter?` — ${teamFilter}`:""}{saleFilter?` — ${saleFilter}`:""}
              </div>
              {filteredTop5.length===0?<div style={{fontSize:11,color:"#aaa",padding:"12px 0",textAlign:"center"}}>{t.noData}</div>
              :filteredTop5.map((c,i)=>(
                <div key={c.cust_code} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:i<filteredTop5.length-1?`0.5px solid ${dark?"#222":"rgba(0,0,0,0.06)"}`:``}}>
                  <span style={{width:18,height:18,borderRadius:"50%",background:i<3?"#E24B4A":dark?"#3D2A00":"#FAEEDA",color:i<3?"#fff":dark?"#FAC775":"#854F0B",fontSize:9,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</span>
                  <span style={{flex:1,fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:dark?"#ddd":"#111"}}>{c.customer_name}</span>
                  <span style={{fontSize:11,color:dark?"#F09595":"#A32D2D",fontWeight:500,flexShrink:0}}>{c.max_days.toLocaleString()} {t.days}</span>
                </div>
              ))}
            </div>
            <div style={cardStyle}>
              <div style={{fontSize:12,fontWeight:600,color:dark?"#ddd":"#555",marginBottom:10}}>
                {t.saleSummary}{teamFilter?` (${teamFilter})`:""}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"70px 1fr 36px 36px 80px",gap:4,fontSize:10,fontWeight:500,color:"#555",marginBottom:6,paddingBottom:4,borderBottom:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.08)"}`}}>
                <span>Sale</span><span>BLOCK%</span><span style={{textAlign:"center"}}>BL</span><span style={{textAlign:"center"}}>WA</span><span style={{textAlign:"right"}}>{t.value}</span>
              </div>
              <div style={{maxHeight:200,overflowY:"auto"}}>
                {filteredSaleRanking.map(s=>{
                  const maxBl=Math.max(...filteredSaleRanking.map(r=>r.block_count),1);
                  const pct=Math.round((s.block_count/maxBl)*100);
                  return (
                    <div key={s.sale} style={{display:"grid",gridTemplateColumns:"70px 1fr 36px 36px 80px",gap:4,alignItems:"center",padding:"5px 0",borderBottom:`0.5px solid ${dark?"#1e1e1e":"rgba(0,0,0,0.04)"}`,fontSize:11}}>
                      <span style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:dark?"#ddd":"#111"}}>{s.sale}</span>
                      <div style={{background:dark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)",borderRadius:4,height:6}}>
                        <div style={{background:s.block_count>0?"#E24B4A":"#EF9F27",borderRadius:4,height:6,width:`${pct}%`}}/>
                      </div>
                      <span style={{textAlign:"center",color:dark?"#F09595":"#A32D2D",fontWeight:500}}>{s.block_count||"—"}</span>
                      <span style={{textAlign:"center",color:dark?"#FAC775":"#854F0B"}}>{s.warn_count||"—"}</span>
                      <span style={{textAlign:"right",fontSize:10,color:dark?"#ddd":"#888"}}>{fmtVal(s.total_value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Row 3: Top10 + Head-to-Head */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={cardStyle}>
            <div style={{fontSize:12,fontWeight:600,color:dark?"#ddd":"#555",marginBottom:10}}>
              {t.top10Value}{teamFilter?` — ${teamFilter}`:""}{saleFilter?` — ${saleFilter}`:""}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"22px 1fr 60px 80px 65px",gap:4,fontSize:10,fontWeight:500,color:"#555",marginBottom:6,paddingBottom:4,borderBottom:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.08)"}`}}>
              <span>#</span><span>{t.custName}</span><span>Sale</span><span style={{textAlign:"right"}}>{t.value}</span><span style={{textAlign:"center"}}>{t.status}</span>
            </div>
            {[...filtered].sort((a,b)=>(custValues[b.cust_code]||0)-(custValues[a.cust_code]||0)).slice(0,10).map((c,i)=>{
              const val=custValues[c.cust_code]||0;
              const sc=c.status==="BLOCK"?(dark?"#F09595":"#A32D2D"):c.status==="WARNING"?(dark?"#FAC775":"#854F0B"):(dark?"#C0DD97":"#3B6D11");
              const rbg=c.status==="BLOCK"?(dark?"#1e0e0e":"transparent"):c.status==="WARNING"?(dark?"#1e1600":"transparent"):"transparent";
              return (
                <div key={c.cust_code} style={{display:"grid",gridTemplateColumns:"22px 1fr 60px 80px 65px",gap:4,alignItems:"center",padding:"6px 0",borderBottom:`0.5px solid ${dark?"#1e1e1e":"rgba(0,0,0,0.05)"}`,fontSize:11,background:rbg}}>
                  <span style={{color:dark?"#555":"#aaa"}}>{i+1}</span>
                  <span style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:dark?"#ddd":"#111"}}>{c.customer_name}</span>
                  <span style={{color:dark?"#888":"#777",fontSize:10}}>{c.sale}</span>
                  <span style={{textAlign:"right",fontWeight:600,color:sc}}>{val?fmtVal(val):"—"}</span>
                  <span style={{textAlign:"center"}}>
                    {c.status==="BLOCK"?<span style={{background:dark?"#3D1212":"#E24B4A",color:dark?"#F09595":"#fff",borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:600}}>BLOCK</span>
                    :c.status==="WARNING"?<span style={{background:dark?"#3D2A00":"#EF9F27",color:dark?"#FAC775":"#fff",borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:600}}>WARNING</span>
                    :<span style={{background:dark?"#1A2E0A":"#EAF3DE",color:dark?"#C0DD97":"#3B6D11",border:`0.5px solid ${dark?"#3A6014":"#C0DD97"}`,borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:600}}>NORMAL</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={cardStyle}>
            <div style={{fontSize:12,fontWeight:600,color:dark?"#ddd":"#555",marginBottom:12}}>เปรียบเทียบ Sale</div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16}}>
              <select className="v2-filter-sel" value={h2hA} onChange={e=>setH2hA(e.target.value)} style={{flex:1,minWidth:0}}>
                <option value="">เลือก Sale A</option>
                {allSaleNames.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{color:"#555",fontWeight:600,fontSize:13,flexShrink:0}}>VS</span>
              <select className="v2-filter-sel" value={h2hB} onChange={e=>setH2hB(e.target.value)} style={{flex:1,minWidth:0}}>
                <option value="">เลือก Sale B</option>
                {allSaleNames.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {(!h2hA||!h2hB)?(
              <div style={{height:160,display:"flex",alignItems:"center",justifyContent:"center",color:dark?"#333":"#ccc",fontSize:12}}>เลือก Sale 2 คนเพื่อเปรียบเทียบ</div>
            ):(()=>{
              return (
                <>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:12,fontSize:12}}>
                    <span style={{color:"#E24B4A",fontWeight:600}}>{h2hA}</span>
                    <span style={{color:"#378ADD",fontWeight:600}}>{h2hB}</span>
                  </div>
                  {[
                    ["ลูกค้า",da.total,db2.total],
                    ["BLOCK",da.block,db2.block],
                    ["WARNING",da.warn,db2.warn],
                    ["NORMAL",da.normal,db2.normal],
                    ["วันค้างสูงสุด",da.maxDays,db2.maxDays],
                  ].map(([label,v1,v2])=>{
                    const max=Math.max(v1,v2,1);
                    return (
                      <div key={label} style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{fontSize:11,fontWeight:600,color:"#E24B4A"}}>{v1}</span>
                          <span style={{fontSize:10,color:dark?"#666":"#aaa"}}>{label}</span>
                          <span style={{fontSize:11,fontWeight:600,color:"#378ADD"}}>{v2}</span>
                        </div>
                        <div style={{display:"flex",gap:2,alignItems:"center"}}>
                          <div style={{flex:1,display:"flex",justifyContent:"flex-end"}}>
                            <div style={{height:7,width:`${Math.round(v1/max*100)}%`,background:"#E24B4A",borderRadius:"4px 0 0 4px",opacity:0.8}}/>
                          </div>
                          <div style={{width:1,height:10,background:dark?"#333":"#ddd",flexShrink:0}}/>
                          <div style={{flex:1}}>
                            <div style={{height:7,width:`${Math.round(v2/max*100)}%`,background:"#378ADD",borderRadius:"0 4px 4px 0",opacity:0.8}}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>

        {/* Row 4: Full table */}
        <div style={{background:dark?"#141414":"#fff",border:`0.5px solid ${dark?"#222":"rgba(0,0,0,0.1)"}`,borderRadius:10,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:580}}>
              <thead>
                <tr style={{position:"sticky",top:0,zIndex:5,background:dark?"#1a1a1a":"#f9f9f7"}}>
                  {["#",t.custCode,t.custName,t.team,"Sale",t.br,t.daysOverdue,t.status,t.updated].map((h,i)=>(
                    <th key={i} style={{padding:"8px 11px",textAlign:"left",fontSize:11,fontWeight:500,color:dark?"#ddd":"#888",borderBottom:`0.5px solid ${dark?"#2a2a2a":"rgba(0,0,0,0.08)"}`,
                      width:i===0?"28px":i===1?"85px":i===3?"80px":i===4?"80px":i===5?"45px":i===6?"80px":i===7?"85px":i===8?"70px":"auto"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c,i)=>{
                  const bg=c.status==="BLOCK"?(dark?"#1e0e0e":"#FDF0F0"):c.status==="WARNING"?(dark?"#1e1600":"#FDF6E8"):"transparent";
                  const tc=TEAM_COLORS[c.team]||"#888";
                  return (
                    <tr key={c.cust_code} style={{background:bg,borderBottom:`0.5px solid ${dark?"#1e1e1e":"rgba(0,0,0,0.05)"}`}}>
                      <td style={{padding:"7px 11px",fontSize:11,color:"#555"}}>{i+1}</td>
                      <td style={{padding:"7px 11px",fontSize:11,fontWeight:500,color:dark?"#ddd":"#555",fontFamily:"monospace"}}>{c.cust_code}</td>
                      <td style={{padding:"7px 11px",fontSize:11,fontWeight:500,color:dark?"#ddd":"#111"}}>{c.customer_name}</td>
                      <td style={{padding:"7px 11px"}}><span style={{fontSize:10,fontWeight:500,color:tc,background:tc+"22",border:`0.5px solid ${tc}55`,borderRadius:4,padding:"1px 6px"}}>{c.team}</span></td>
                      <td style={{padding:"7px 11px",fontSize:11,color:dark?"#ddd":"#777"}}>{c.sale}</td>
                      <td style={{padding:"7px 11px",fontSize:11,color:dark?"#ddd":"#aaa"}}>{c.active_br_count}</td>
                      <td style={{padding:"7px 11px",fontSize:11,fontWeight:c.max_days>90?500:400,color:c.max_days>180?(dark?"#F09595":"#A32D2D"):c.max_days>90?(dark?"#FAC775":"#854F0B"):(dark?"#ddd":"#1a1a1a")}}>{c.max_days} {t.days}</td>
                      <td style={{padding:"7px 11px"}}><StatusBadge status={c.status}/></td>
                      <td style={{padding:"7px 11px",fontSize:10,color:dark?"#ddd":"#bbb"}}>{c.updated_at?new Date(c.updated_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}):"—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Row 5: Sync log */}
        <div>
          <div style={{fontSize:12,fontWeight:600,color:dark?"#ddd":"#555",marginBottom:8}}>{t.syncLog}</div>
          <div style={{background:dark?"#141414":"#fff",border:`0.5px solid ${dark?"#222":"rgba(0,0,0,0.1)"}`,borderRadius:10,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:480}}>
                <thead style={{background:dark?"#1a1a1a":"#f9f9f7"}}>
                  <tr>{["เวลา","สถานะ","ใหม่","เปลี่ยน","ปิด","error","เวลา(s)","หมายเหตุ"].map(h=>(
                    <th key={h} style={{padding:"7px 11px",textAlign:"left",fontSize:11,fontWeight:500,color:dark?"#ddd":"#888"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {syncLogs.map((l,i)=>{
                    const sc=l.status==="success"
                      ?{bg:dark?"#162010":"#EAF3DE",txt:dark?"#C0DD97":"#3B6D11",bd:dark?"#3A6014":"#C0DD97",label:lang==="th"?"สำเร็จ":"Success"}
                      :l.status==="partial"
                      ?{bg:dark?"#2D1E00":"#FAEEDA",txt:dark?"#FAC775":"#854F0B",bd:dark?"#7A5500":"#FAC775",label:lang==="th"?"บางส่วน":"Partial"}
                      :{bg:dark?"#2D1010":"#FCEBEB",txt:dark?"#F09595":"#A32D2D",bd:dark?"#7A2020":"#F09595",label:lang==="th"?"ล้มเหลว":"Failed"};
                    return (
                      <tr key={i} style={{borderBottom:`0.5px solid ${dark?"#1e1e1e":"rgba(0,0,0,0.05)"}`}}>
                        <td style={{padding:"7px 11px",fontSize:11,color:"#888"}}>{l.synced_at?new Date(l.synced_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—"}</td>
                        <td style={{padding:"7px 11px"}}><span style={{display:"inline-flex",alignItems:"center",gap:4,background:sc.bg,color:sc.txt,border:`0.5px solid ${sc.bd}`,borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:500}}>{sc.label}</span></td>
                        <td style={{padding:"7px 11px",fontSize:11,color:"#378ADD"}}>{l.br_inserted>0?"+"+l.br_inserted:"—"}</td>
                        <td style={{padding:"7px 11px",fontSize:11,color:"#888"}}>{l.br_updated||"—"}</td>
                        <td style={{padding:"7px 11px",fontSize:11,color:"#888"}}>{l.br_closed>0?"-"+l.br_closed:"—"}</td>
                        <td style={{padding:"7px 11px",fontSize:11,color:l.errors>0?(dark?"#F09595":"#A32D2D"):"#555"}}>{l.errors||"—"}</td>
                        <td style={{padding:"7px 11px",fontSize:11,color:"#888"}}>{(l.duration_ms/1000).toFixed(1)}</td>
                        <td style={{padding:"7px 11px",fontSize:11,color:dark?"#F09595":"#A32D2D"}}>{l.error_msg||"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}