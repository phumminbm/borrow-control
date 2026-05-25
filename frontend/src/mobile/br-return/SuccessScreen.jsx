// =============================================================================
// SuccessScreen.jsx — Full-screen confirmation view after a successful submit
//
// Replaces the tab content + bottom tab bar when MobileApp's
// `submittedRequest` state is set. Triggered by the bubble-up from
// RequestReturnSheet.onSubmitted → CustomerDetailSheet.onRequestSubmitted →
// MobileApp.setSubmittedRequest.
//
// Body content: check icon, heading, RT-ID card (id / locale-aware date /
// status pill + flow text), and a next-step explanation card. Bottom
// destination buttons (Back to BR list / View All Requests) live in
// MobileApp.jsx so they sit in the fixed footer where the tab bar
// normally would.
//
// Lifted from MobilePrototypeApp.jsx:3596-3636 with two production tweaks:
//   1. Date is rebuilt from req.dateSort (locale-agnostic INT) so it tracks
//      the active language. The prototype used req.date directly, which is
//      a pre-formatted display string with the submit-time locale baked in.
//   2. Removed prototype-only badge / branding lines (none here — already
//      clean in the prototype).
// =============================================================================

import { ReturnStatusPill } from "./components";
import { THAI_MONTHS_SHORT, EN_MONTHS_SHORT, fmtDateTime } from "./helpers";

// Locale-aware date rebuilt from dateSort (BBBBMMDD INT4) so the success
// screen shows the date in the CURRENT language, not the submit-time one.
// Mirrors the same helper in ReturnsScreen.jsx.
function displaySuccessDate(req, lang) {
  const ds = Number(req && req.dateSort) || 0;
  if (ds > 0) {
    const day = ds % 100;
    const month = Math.floor(ds / 100) % 100;
    const buddhistYear = Math.floor(ds / 10000);
    const monShort = (lang === "en" ? EN_MONTHS_SHORT : THAI_MONTHS_SHORT)[month - 1] || "";
    const year = lang === "en" ? buddhistYear - 543 : buddhistYear;
    if (monShort && day > 0 && year > 0) return `${day} ${monShort} ${year}`;
  }
  const raw = req && req.date ? String(req.date) : "";
  if (raw) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return fmtDateTime(raw, lang);
    return raw;
  }
  return "—";
}

export function SuccessScreen({ req, lang, dark }) {
  const text = dark ? "#eee" : "#111";
  const sub  = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr  = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  return (
    <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 20px 24px" }}>
      {/* Check icon + heading */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 40 }}>
        <div style={{
          width: 92, height: 92, borderRadius: "50%",
          background: "linear-gradient(135deg, #639922, #3A6014)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 22, boxShadow: "0 8px 30px rgba(99,153,34,0.3)",
        }}>
          <svg width="46" height="46" viewBox="0 0 24 24">
            <path d="M5 12l5 5L20 7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: text, marginBottom: 8 }}>
          {lang === "th" ? "ส่งคำขอสำเร็จ" : "Submitted Successfully"}
        </div>
        <div style={{ fontSize: 12, color: sub, textAlign: "center", maxWidth: 300, lineHeight: 1.6, marginBottom: 24 }}>
          {lang === "th"
            ? <>คำขอของคุณถูกบันทึกแล้ว Admin จะตรวจสอบและอนุมัติให้<br/>สามารถดูสถานะได้ที่แท็บ <b style={{ color: "#D4357A" }}>คืนสินค้า</b></>
            : <>Your request has been saved. Admin will review and approve.<br/>Track its status under the <b style={{ color: "#D4357A" }}>Returns</b> tab.</>}
        </div>
      </div>

      {/* RT-ID card */}
      <div style={{
        width: "100%", padding: 16, background: card,
        border: `0.5px solid ${bdr}`, borderRadius: 13, marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
          {lang === "th" ? "เลขที่คำขอ" : "Request ID"}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: text }}>
          {req.id || req.requestId}
        </div>
        <div style={{ fontSize: 11, color: sub, marginTop: 4 }}>
          {displaySuccessDate(req, lang)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <ReturnStatusPill status={req.status || "pending"} size="sm" lang={lang} />
          <span style={{ fontSize: 11, color: sub }}>
            → Admin {lang === "th" ? "ตรวจสอบ" : "review"} → Sheet sync
          </span>
        </div>
      </div>

      {/* Next-step explanation */}
      <div style={{
        padding: "13px 14px",
        background: dark ? "#0a0a0a" : "#fafaf8",
        border: `0.5px dashed ${dark ? "#2a2a2a" : "#ddd"}`,
        borderRadius: 11, fontSize: 12, color: sub, lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 600, color: dark ? "#bbb" : "#444", marginBottom: 4 }}>
          📌 {lang === "th" ? "ขั้นถัดไป" : "Next steps"}
        </div>
        {lang === "th"
          ? "Admin จะอนุมัติและระบบจะ Sync กับ Logistics File โดยอัตโนมัติ การเปลี่ยนแปลงจะปรากฏใน Dashboard ในรอบ snapshot คืนถัดไป"
          : "Admin will approve and the system syncs to Logistics File automatically. Changes will appear on the Dashboard at the next nightly snapshot."}
      </div>
    </div>
  );
}
