// =============================================================================
// RequestReturnSheet.jsx — Production 4-step return request form (Mobile)
//
// Extracted from MobilePrototypeApp.jsx (lines 1130-1925) with prototype
// scaffolding removed and real API calls wired in.
//
// Prototype scaffolding removed:
//   • PrototypeBadge reference in header
//   • Test-mode disclaimer banner on Step 4
//   • genProtoReturnId() → genReturnId() from helpers.js
//   • upsertProtoReturn() → submitReturnRequest() from api.js
//   • replaceProtoReturn() → submitReturnRequest() from api.js (resubmit path)
//   • _prototype: true flag in new-request payload
//
// Props:
//   open           {boolean}   Mount/unmount the sheet
//   onClose        {function}  Close without submitting
//   br             {object}    { borrow_no, items: [{item_id, line_no, product_code,
//                               product_name, price, quantity}] } — null in edit mode
//   customer       {object}    { customer_name, cust_code } — null in edit mode
//   sale           {string}    Sale name for the new request
//   lang           {'th'|'en'}
//   dark           {boolean}
//   onSubmitted    {function}  Called with backend response (or payload) on success
//   editingRequest {object}    When set, opens in edit-and-resubmit mode
// =============================================================================

import { useState, useEffect } from "react";
import { BottomSheet, Icon } from "./shared";
import { RETURN_TYPES, STATUS_META, typeLabel, breakdownFor } from "./constants";
import { genReturnId, todayDateSort } from "./helpers";
import { submitReturnRequest } from "./api";

export function RequestReturnSheet({ open, onClose, br, customer, sale, lang, dark, onSubmitted, editingRequest = null }) {
  const isEditing = !!editingRequest;
  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [perItem, setPerItem] = useState({}); // item_id -> { retQty, clmQty, saleQty, freeQty }
  const [remark, setRemark] = useState("");
  // Submit-state (async, backend-aware): submitting disables the Submit
  // button + shows a spinner; submitError lives at the bottom of Step 4
  // and tells the Sale exactly what failed. Both reset on sheet open.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // ── Editing mode: synthesise br/customer/items from the rejected record ──
  // The Sale-side resubmission path reads everything it needs straight off
  // the existing return record — no fresh /customers/{cc}/brs fetch. The
  // "items" surface for Step 1 is the set of rejected items only, matching
  // Desktop br-return.html:3156-3167 (editRejectedOnly = true). Approved
  // items pass through untouched at submit-time.
  const editCustomer = isEditing
    ? { customer_name: editingRequest.custName || editingRequest.cust, cust_code: editingRequest.custCode }
    : null;
  const editBr = isEditing
    ? {
        borrow_no: editingRequest.brNo || editingRequest.br,
        items: (editingRequest.rejectedItems || []).map(r => ({
          item_id: r.itemId || r.item_id || `${r.code || r.product_code}-${r.lineNo || r.line_no || ""}`,
          line_no: r.lineNo || r.line_no,
          product_code: r.code || r.product_code,
          product_name: r.name || r.product_name,
          price: Number(r.price) || 0,
          // In edit mode, the max re-allocatable qty is the qty originally
          // submitted for this row (Sale cannot suddenly inflate the count).
          quantity: Number(r.quantity) || 0,
          _rejectReason: r.reason || "",
        })),
      }
    : null;

  const effectiveCustomer = isEditing ? editCustomer : customer;
  const effectiveBr       = isEditing ? editBr       : br;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubmitting(false);
    setSubmitError("");
    if (isEditing) {
      // Pre-select every rejected row (Sale needs to address all of them
      // to fix the request) but leave qty allocation BLANK — Sale must
      // re-enter the corrected numbers explicitly, exactly like Desktop
      // (br-return.html:3167 has no qty pre-fill).
      const ids = new Set();
      const initAlloc = {};
      for (const r of (editingRequest.rejectedItems || [])) {
        const id = r.itemId || r.item_id || `${r.code || r.product_code}-${r.lineNo || r.line_no || ""}`;
        ids.add(id);
        initAlloc[id] = { retQty: 0, clmQty: 0, saleQty: 0, freeQty: 0 };
      }
      setSelectedIds(ids);
      setPerItem(initAlloc);
      setRemark(editingRequest.remark || "");
    } else {
      setSelectedIds(new Set());
      setPerItem({});
      setRemark("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, br?.borrow_no, editingRequest?.requestId, editingRequest?.id]);

  if (!effectiveBr || !effectiveCustomer) {
    return <BottomSheet open={open} onClose={onClose} height="92%" dark={dark} title={lang === "th" ? (isEditing ? "แก้ไขคำขอ" : "ขอคืนสินค้า") : (isEditing ? "Edit Request" : "Request Return")} />;
  }

  const text = dark ? "#eee" : "#111";
  const sub = dark ? "#888" : "#666";
  const card = dark ? "#141414" : "#fff";
  const bdr = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";

  const items = Array.isArray(effectiveBr.items) ? effectiveBr.items : [];
  const selectedItems = items.filter(it => selectedIds.has(it.item_id));

  // Items previously approved by Admin — shown as a read-only summary above
  // Step 1's editable list so the Sale has full context of the request.
  const approvedPassthroughItems = isEditing
    ? (editingRequest.submittedItems || []).filter(si => {
        const wasRejected = (editingRequest.rejectedItems || []).some(r =>
          (r.itemId && r.itemId === si.item_id)
          || ((r.code || r.product_code) === si.product_code && (r.lineNo || r.line_no) === si.line_no)
        );
        return !wasRejected;
      })
    : [];

  // ── Per-item allocation model ────────────────────────────────────────
  // perItem[id] = { retQty, clmQty, saleQty, freeQty }
  // Mirrors the desktop BR Return flow: one source row can be split into
  // multiple return types simultaneously, as long as the sum across types
  // does not exceed the source row's available quantity.
  const QTY_KEY = { RETURN: "retQty", CLAIM: "clmQty", SALE: "saleQty", FREE: "freeQty" };
  const blankAlloc = () => ({ retQty: 0, clmQty: 0, saleQty: 0, freeQty: 0 });

  function togglePick(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { next.add(id); }
      return next;
    });
    setPerItem(prev => {
      if (prev[id]) return prev;
      // Start fully empty — Sale chooses qty+type explicitly. No pre-fill so
      // the workflow does not accidentally suggest "all RETURN" before Sale
      // has actually decided. User must allocate at least one piece across
      // any type for Step 2 validation to pass (see validStep2).
      return { ...prev, [id]: blankAlloc() };
    });
  }

  // Set a single type's qty for one item, clamped so the total across all
  // four types never exceeds the source row's available quantity.
  function setItemTypeQty(id, typeKey, nextQty) {
    const it = items.find(i => i.item_id === id);
    if (!it) return;
    const max = it.quantity;
    setPerItem(prev => {
      const cur = prev[id] || blankAlloc();
      const otherTotal = (cur.retQty || 0) + (cur.clmQty || 0) + (cur.saleQty || 0) + (cur.freeQty || 0) - (cur[QTY_KEY[typeKey]] || 0);
      const clamped = Math.max(0, Math.min(nextQty, max - otherTotal));
      return { ...prev, [id]: { ...cur, [QTY_KEY[typeKey]]: clamped } };
    });
  }

  // Bulk "Select all as TYPE" — sets every currently-selected item so that
  // the chosen type gets the item's full available quantity and the other
  // three types are zeroed. Matches the desktop quick-fill buttons.
  function selectAllAsType(typeKey) {
    setPerItem(prev => {
      const next = { ...prev };
      for (const id of selectedIds) {
        const it = items.find(i => i.item_id === id);
        if (!it) continue;
        next[id] = { ...blankAlloc(), [QTY_KEY[typeKey]]: it.quantity };
      }
      return next;
    });
  }

  function totalForItem(id) {
    const cur = perItem[id] || blankAlloc();
    return (cur.retQty || 0) + (cur.clmQty || 0) + (cur.saleQty || 0) + (cur.freeQty || 0);
  }

  const submittedItems = selectedItems.map(it => {
    const cur = perItem[it.item_id] || blankAlloc();
    const retQty  = Math.max(0, cur.retQty  || 0);
    const clmQty  = Math.max(0, cur.clmQty  || 0);
    const saleQty = Math.max(0, cur.saleQty || 0);
    const freeQty = Math.max(0, cur.freeQty || 0);
    const totalQty = retQty + clmQty + saleQty + freeQty;
    const price = Number(it.price) || 0;
    // Match the EXACT field shape Desktop BR Return writes for items.
    // Desktop's renderer reads `code`, `name`, `itemId`, `lineNo`, `lineKey`.
    // We also keep the snake_case aliases so Mobile's own renderers
    // (which read either shape) keep working.
    return {
      // Desktop-canonical:
      code: it.product_code,
      name: it.product_name,
      price,
      quantity: totalQty,
      totalPrice: price * totalQty,
      retQty, clmQty, saleQty, freeQty,
      itemId: it.item_id,
      lineNo: it.line_no,
      lineKey: `line:${it.line_no}|code:${it.product_code}`,
      // Mobile aliases (read by breakdownFor + various detail views):
      item_id: it.item_id,
      line_no: it.line_no,
      product_code: it.product_code,
      product_name: it.product_name,
    };
  });
  const totalValue = submittedItems.reduce((s, x) => s + x.totalPrice, 0);
  // Valid when every selected item has at least 1 allocated AND the total
  // allocation doesn't exceed the source row's quantity.
  const validStep2 = submittedItems.every(x => {
    const avail = (items.find(i => i.item_id === x.item_id)?.quantity || 0);
    return x.quantity > 0 && x.quantity <= avail;
  });

  async function submit() {
    if (submitting) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      if (isEditing) {
        // Resubmit corrected request — keep the same requestId; submittedItems
        // contains ONLY the corrected items (NOT merged with the already-approved
        // ones). Desktop Admin sees only what was just re-touched, per the
        // correction-flow design: "Admin should see only the corrected/resubmitted
        // item(s), not the full original item list".
        //
        // The approved items aren't lost — they're snapshotted into
        // revisionHistory[N].prevSubmittedItems. The Desktop history viewer
        // can replay each round.
        //
        // Mirrors Desktop br-return.html:2960-2963 (status='pending',
        // adminNote='', rejectedItems=[], attachments=[]) plus the
        // revisionHistory extension.
        const orig = editingRequest;
        const prevHistory = Array.isArray(orig.revisionHistory) ? orig.revisionHistory : [];
        const correctedItemIds = (orig.rejectedItems || [])
          .map(r => r.itemId || r.item_id || `${r.code || r.product_code}-${r.lineNo || r.line_no || ""}`)
          .filter(Boolean);
        const snapshot = {
          at: new Date().toISOString(),
          prevStatus: orig.status || "rejected",
          prevAdminNote: orig.adminNote || "",
          prevSubmittedItems: Array.isArray(orig.submittedItems) ? orig.submittedItems : [],
          prevRejectedItems: Array.isArray(orig.rejectedItems) ? orig.rejectedItems : [],
          prevAttachments: Array.isArray(orig.attachments) ? orig.attachments : [],
          prevRejectedItemCount: (orig.rejectedItems || []).length,
          prevAttachmentCount: (orig.attachments || []).length,
          correctedItemIds,
        };
        const payload = {
          requestId: orig.requestId || orig.id,
          custCode: orig.custCode,
          custName: orig.custName || orig.cust,
          brNo: orig.brNo || orig.br,
          sale: orig.sale,
          status: "pending",
          dateSort: todayDateSort(),
          remark: remark.trim() || orig.remark || "",
          submittedItems,
          adminNote: "",
          rejectedItems: [],
          attachments: [],
          resubmittedAt: new Date().toISOString(),
          revisionHistory: [...prevHistory, snapshot],
          isTest: false,
        };
        const result = await submitReturnRequest(payload);
        if (!result.ok) throw new Error(result.error || "Resubmit failed");
        if (onSubmitted) onSubmitted(result.data || payload);
        return;
      }
      // New request
      const requestId = genReturnId();
      const payload = {
        requestId,
        custCode: effectiveCustomer.cust_code,
        custName: effectiveCustomer.customer_name,
        brNo: effectiveBr.borrow_no,
        sale,
        status: "pending",
        date: new Date().toISOString(),
        dateSort: todayDateSort(),
        remark: remark.trim(),
        adminNote: "",
        rejectedItems: [],
        attachments: [],
        submittedItems,
        cancelReason: "",
        sheetSync: "none",
        sheetSyncAt: "",
        sheetSyncError: "",
        revisionHistory: [],
        isTest: false,
      };
      const result = await submitReturnRequest(payload);
      if (!result.ok) throw new Error(result.error || "Submit failed");
      if (onSubmitted) onSubmitted(result.data || payload);
    } catch (err) {
      setSubmitError(
        (err && err.message)
          ? (lang === "th" ? `บันทึกคำขอไม่สำเร็จ — ${err.message}` : `Submit failed — ${err.message}`)
          : (lang === "th" ? "บันทึกคำขอไม่สำเร็จ ลองอีกครั้ง" : "Submit failed — please retry")
      );
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = lang === "th"
    ? ["เลือก", "จำนวน", "หมายเหตุ", "ตรวจสอบ"]
    : ["Select", "Quantity", "Remark", "Review"];

  return (
    <BottomSheet open={open} onClose={onClose} height="92%" dark={dark}>
      {/* Header */}
      <div style={{ padding: "4px 20px 12px", borderBottom: `0.5px solid ${bdr}`, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: isEditing ? "#D4357A" : sub }}>
            {isEditing
              ? (lang === "th" ? `📝 แก้ไขคำขอ · ${editingRequest.requestId || editingRequest.id}` : `📝 Edit · ${editingRequest.requestId || editingRequest.id}`)
              : (lang === "th" ? "ขอคืนสินค้า" : "Request Return")}
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${bdr}`, background: dark ? "#222" : "#f0f0ec", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="close" size={14} color={sub} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, fontSize: 11, color: sub, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "ui-monospace,monospace", color: text, fontWeight: 600 }}>{effectiveBr.borrow_no}</span>·
          <span>{effectiveCustomer.customer_name}</span>·
          <span style={{ fontFamily: "ui-monospace,monospace" }}>{effectiveCustomer.cust_code}</span>
        </div>
        {/* Steps */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 12 }}>
          {stepLabels.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600, color: active ? "#D4357A" : done ? "#97C459" : sub }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: active ? "#D4357A" : done ? "#1A2E0A" : (dark ? "#1a1a1a" : "#f5f5f3"), color: active ? "#fff" : done ? "#97C459" : sub, border: `0.5px solid ${active ? "#D4357A" : done ? "#3A6014" : (dark ? "#333" : "#ddd")}`, fontSize: 10, fontWeight: 700 }}>
                  {done ? "✓" : n}
                </div>
                <span style={{ whiteSpace: "nowrap" }}>{label}</span>
                {i < stepLabels.length - 1 && <div style={{ flex: 1, height: 0.5, background: dark ? "#2a2a2a" : "#ddd", margin: "0 4px" }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", color: text }}>
        {step === 1 && (
          <>
            {/* Editing-mode context banner */}
            {isEditing && (
              <div style={{
                background: STATUS_META.rejected.bg,
                border: `0.5px solid ${STATUS_META.rejected.border}`,
                borderRadius: 11, padding: "11px 13px", marginBottom: 12,
                color: "#fff",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, letterSpacing: 0.4, textTransform: "uppercase", color: "#fff" }}>
                  ↻ {lang === "th" ? "กำลังแก้ไขคำขอ" : "Editing request"}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: "#fff" }}>
                  {lang === "th"
                    ? `แก้ไขเฉพาะรายการที่ Admin ขอแก้ ${editingRequest.rejectedItems?.length || 0} รายการ — รายการอื่นจะคงเดิม`
                    : `Edit only the ${editingRequest.rejectedItems?.length || 0} item(s) Admin flagged. The rest are kept as-is.`}
                </div>
                {editingRequest.adminNote && (
                  <div style={{ marginTop: 7, fontSize: 11, color: "#fff", lineHeight: 1.5, whiteSpace: "pre-line", opacity: 0.92 }}>
                    <b>{lang === "th" ? "หมายเหตุ Admin: " : "Admin note: "}</b>{editingRequest.adminNote}
                  </div>
                )}
              </div>
            )}
            {/* Approved-passthrough summary — read-only */}
            {isEditing && approvedPassthroughItems.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: STATUS_META.approved.color, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
                  ✓ {lang === "th" ? `อนุมัติแล้ว (คงเดิม)` : "Approved (kept)"} ({approvedPassthroughItems.length})
                </div>
                <div style={{ background: card, border: `0.5px dashed ${STATUS_META.approved.border}`, borderRadius: 11, overflow: "hidden" }}>
                  {approvedPassthroughItems.map((si, i) => (
                    <div key={i} style={{ padding: "9px 12px", borderBottom: i < approvedPassthroughItems.length - 1 ? `0.5px solid ${bdr}` : "none", opacity: 0.85 }}>
                      <div style={{ fontSize: 10, color: sub, fontFamily: "ui-monospace,monospace" }}>{si.product_code || si.code}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: text }}>{si.product_name}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 2 }}>
                        {si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} · ฿{Number(si.totalPrice || 0).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Header row: section label + Select-All toggle */}
            {(() => {
              const allSelected = items.length > 0 && selectedIds.size === items.length;
              const disabled = items.length === 0;
              return (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: isEditing ? STATUS_META.rejected.color : sub, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>
                    {isEditing
                      ? (lang === "th" ? "ส่วนที่ต้องแก้ไข" : "Items to revise")
                      : (lang === "th" ? "เลือกรายการที่จะคืน" : "Select items to return")}
                  </div>
                  <button
                    onClick={() => {
                      if (disabled) return;
                      if (allSelected) {
                        setSelectedIds(new Set());
                      } else {
                        const allIds = items.map(it => it.item_id);
                        setSelectedIds(new Set(allIds));
                        setPerItem(prev => {
                          const next = { ...prev };
                          for (const id of allIds) {
                            if (!next[id]) next[id] = blankAlloc();
                          }
                          return next;
                        });
                      }
                    }}
                    disabled={disabled}
                    style={{
                      fontSize: 11, fontWeight: 700,
                      padding: "5px 11px", borderRadius: 999,
                      border: `1px solid ${allSelected ? bdr : "#D4357A"}`,
                      background: allSelected ? "transparent" : (dark ? "rgba(212,53,122,0.12)" : "rgba(212,53,122,0.08)"),
                      color: allSelected ? sub : "#D4357A",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.4 : 1,
                      fontFamily: "inherit",
                      display: "inline-flex", alignItems: "center", gap: 5,
                      letterSpacing: 0.2,
                    }}
                  >
                    {allSelected
                      ? (lang === "th" ? "ล้างการเลือก" : "Clear all")
                      : (lang === "th" ? "เลือกทั้งหมด" : "Select all")}
                  </button>
                </div>
              );
            })()}
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: sub, fontSize: 12 }}>{lang === "th" ? "ไม่มีรายการในใบยืมนี้" : "No items in this BR"}</div>
            ) : items.map(it => {
              const checked = selectedIds.has(it.item_id);
              const rejectReason = isEditing ? (it._rejectReason || "") : "";
              return (
                <div key={it.item_id} onClick={() => togglePick(it.item_id)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "13px 14px", background: card, border: `1px solid ${checked ? "#D4357A" : bdr}`, borderRadius: 12, marginBottom: 8, cursor: "pointer", boxShadow: checked ? "0 0 0 1px #D4357A55" : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1, border: `1.5px solid ${checked ? "#D4357A" : "rgba(255,255,255,0.15)"}`, background: checked ? "#D4357A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {checked && <Icon name="check" size={14} color="#fff" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 11, color: sub, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{it.product_code}</div>
                      {isEditing && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: STATUS_META.rejected.color, background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 4, padding: "1px 5px", letterSpacing: 0.3, textTransform: "uppercase" }}>
                          {lang === "th" ? "ต้องแก้ไข" : "Revise"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, margin: "2px 0 4px", color: text }}>{it.product_name}</div>
                    <div style={{ fontSize: 10, color: sub }}>{it.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{Number(it.price).toLocaleString()} = ฿{(Number(it.price) * it.quantity).toLocaleString()}</div>
                    {rejectReason && (
                      <div style={{ marginTop: 6, padding: "6px 9px", background: STATUS_META.rejected.bg, border: `0.5px solid ${STATUS_META.rejected.border}`, borderRadius: 6, fontSize: 10, color: STATUS_META.rejected.color, lineHeight: 1.45 }}>
                        <b>{lang === "th" ? "เหตุผล: " : "Reason: "}</b>{rejectReason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ระบุจำนวนแยกประเภท" : "Allocate quantity per type"} ({submittedItems.length})</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 12, lineHeight: 1.5 }}>
              {lang === "th"
                ? "แบ่งจำนวนได้หลายประเภทต่อรายการ (RETURN / CLAIM / SALE / FREE) รวมกันไม่เกินจำนวนที่มีอยู่"
                : "Split one item across multiple types. Total per item must not exceed available qty."}
            </div>

            {/* Quick "Select all as type" bar */}
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: sub, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                {lang === "th" ? "เลือกทั้งหมดเป็น" : "Select all as"}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {RETURN_TYPES.map(t => (
                  <button
                    key={t.key}
                    onClick={() => selectAllAsType(t.key)}
                    style={{
                      flex: 1, padding: "8px 4px", borderRadius: 8,
                      border: `1px solid ${t.border}`,
                      color: t.color, background: "transparent",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      textAlign: "center", fontFamily: "inherit",
                    }}
                  >
                    {t.icon} {typeLabel(t, lang)}
                  </button>
                ))}
              </div>
            </div>

            {submittedItems.map(si => {
              const original = items.find(i => i.item_id === si.item_id);
              const avail = original?.quantity || 0;
              const allocated = (si.retQty || 0) + (si.clmQty || 0) + (si.saleQty || 0) + (si.freeQty || 0);
              const remaining = avail - allocated;
              const remColor = remaining === 0 ? "#97C459" : remaining > 0 ? (dark ? "#FAC775" : "#854F0B") : "#E24B4A";
              const price = Number(original?.price) || 0;

              return (
                <div key={si.item_id} style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, padding: 14, marginBottom: 10 }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: sub, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{original?.product_code}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{original?.product_name}</div>
                    <div style={{ fontSize: 10, color: sub, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{lang === "th" ? "มีอยู่" : "Available"}: <span style={{ color: text, fontWeight: 600 }}>{avail} {lang === "th" ? "ชิ้น" : "pcs"}</span></span>
                      <span style={{ color: remColor, fontWeight: 700 }}>
                        {lang === "th" ? "เหลือ" : "Remaining"}: {remaining} {remaining === 0 ? "✓" : ""}
                      </span>
                    </div>
                  </div>

                  {RETURN_TYPES.map(t => {
                    const cur = perItem[si.item_id] || blankAlloc();
                    const qty = cur[QTY_KEY[t.key]] || 0;
                    const canInc = remaining > 0;
                    const lineVal = qty * price;
                    return (
                      <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `0.5px solid ${bdr}` }}>
                        <div style={{ minWidth: 70, fontSize: 11, fontWeight: 700, color: qty > 0 ? t.color : (dark ? "#666" : "#999") }}>
                          {t.icon} {typeLabel(t, lang)}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", background: dark ? "#1a1a1a" : "#f5f5f3", borderRadius: 7, padding: 2, border: `0.5px solid ${bdr}`, flexShrink: 0 }}>
                          <button
                            onClick={() => setItemTypeQty(si.item_id, t.key, qty - 1)}
                            disabled={qty <= 0}
                            style={{ width: 26, height: 26, border: "none", background: "transparent", color: qty > 0 ? "#D4357A" : (dark ? "#444" : "#ccc"), fontSize: 16, fontWeight: 700, cursor: qty > 0 ? "pointer" : "not-allowed", borderRadius: 5, padding: 0, fontFamily: "inherit" }}
                          >−</button>
                          <span style={{ width: 28, textAlign: "center", fontSize: 13, fontWeight: 700, color: qty > 0 ? text : sub }}>{qty}</span>
                          <button
                            onClick={() => setItemTypeQty(si.item_id, t.key, qty + 1)}
                            disabled={!canInc}
                            style={{ width: 26, height: 26, border: "none", background: "transparent", color: canInc ? "#D4357A" : (dark ? "#444" : "#ccc"), fontSize: 16, fontWeight: 700, cursor: canInc ? "pointer" : "not-allowed", borderRadius: 5, padding: 0, fontFamily: "inherit" }}
                          >+</button>
                        </div>
                        <div style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: qty > 0 ? 700 : 400, color: qty > 0 ? t.color : (dark ? "#444" : "#bbb") }}>
                          {qty > 0 ? `฿${lineVal.toLocaleString()}` : "—"}
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 10, padding: "8px 11px", background: dark ? "#0a0a0a" : "#f8f8f6", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                    <span style={{ color: sub }}>{lang === "th" ? `รวม ${allocated} ชิ้น` : `${allocated} pcs total`}</span>
                    <span style={{ color: allocated > 0 ? "#D4357A" : sub, fontWeight: 700 }}>฿{(allocated * price).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 14, padding: 14, background: "#2D0F1A", border: "0.5px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมทั้งหมด" : "Grand total"}</span>
              <span style={{ fontSize: 15, color: "#D4357A", fontWeight: 700 }}>฿{totalValue.toLocaleString()}</span>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "หมายเหตุ (ถ้ามี)" : "Remark (optional)"}</div>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder={lang === "th" ? "ระบุรายละเอียดที่ Admin ควรทราบ..." : "Add any details Admin should know..."}
              style={{ width: "100%", minHeight: 140, borderRadius: 12, padding: "12px 14px", background: card, border: `0.5px solid ${remark.length >= 500 ? "#EF9F27" : bdr}`, color: text, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, resize: "none", outline: "none" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: 10, color: remark.length >= 500 ? "#EF9F27" : sub }}>
              <span>{remark.length >= 500 ? (lang === "th" ? "ครบ 500 อักษรแล้ว" : "Max 500 chars reached") : ""}</span>
              <span>{remark.length} / 500</span>
            </div>
            <div style={{ fontSize: 11, color: sub, marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "รายการที่จะส่ง" : "Items to submit"}</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden" }}>
              {submittedItems.map(si => {
                const breakdown = breakdownFor(si);
                const primaryColor = breakdown.length === 1 ? breakdown[0].color : "#D4357A";
                return (
                  <div key={si.item_id} style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between", gap: 10, borderBottom: `0.5px solid ${bdr}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>{si.product_code}</div>
                      <div style={{ fontSize: 10, color: sub, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <span>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"}</span>
                        {breakdown.map(b => (
                          <span key={b.key} style={{ color: b.color, fontWeight: 600 }}>
                            {b.icon} {b.qty}{breakdown.length > 1 ? ` ${typeLabel(b, lang)}` : ` ${typeLabel(b, lang).toUpperCase()}`}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: primaryColor, whiteSpace: "nowrap" }}>฿{si.totalPrice.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            {isEditing && (
              <div style={{
                background: "#2D0F1A",
                border: "1px solid #D4357A66",
                borderRadius: 11, padding: "11px 13px", marginBottom: 12,
                color: "#fff",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, letterSpacing: 0.4, textTransform: "uppercase", color: "#fff" }}>
                  📝 {lang === "th" ? "กำลังแก้ไขคำขอ" : "Editing request"} · {editingRequest.requestId || editingRequest.id}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: "#fff" }}>
                  {lang === "th"
                    ? `${approvedPassthroughItems.length} รายการที่ Admin อนุมัติแล้วจะคงเดิม · ${submittedItems.length} รายการแก้ไขใหม่จะถูกส่งให้ Admin ตรวจอีกครั้ง`
                    : `${approvedPassthroughItems.length} approved item(s) will be kept as-is · ${submittedItems.length} revised item(s) will be re-sent for Admin review.`}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "ตรวจสอบก่อนส่ง" : "Review before submit"}</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 10 }}>
              <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}`, display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10, color: sub }}>{lang === "th" ? "ลูกค้า" : "Customer"}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{effectiveCustomer.customer_name}</div>
                </div>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: sub }}>{effectiveCustomer.cust_code}</span>
              </div>
              <div style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}` }}>
                <div style={{ fontSize: 10, color: sub }}>BR</div>
                <div style={{ fontSize: 13, marginTop: 2, fontFamily: "ui-monospace,monospace" }}>{effectiveBr.borrow_no}</div>
              </div>
              <div style={{ padding: "11px 14px" }}>
                <div style={{ fontSize: 10, color: sub }}>Sale</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{sale || editingRequest?.sale || "—"}</div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "รายการ" : "Items"} ({submittedItems.length})</div>
            <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 13, overflow: "hidden", marginBottom: 10 }}>
              {submittedItems.map(si => {
                const breakdown = breakdownFor(si);
                const primaryColor = breakdown.length === 1 ? breakdown[0].color : "#D4357A";
                return (
                  <div key={si.item_id} style={{ padding: "11px 14px", borderBottom: `0.5px solid ${bdr}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: sub }}>{si.product_code}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{si.product_name}</div>
                        <div style={{ fontSize: 10, color: sub, marginTop: 3 }}>{si.quantity} {lang === "th" ? "ชิ้น" : "pcs"} × ฿{si.price.toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: primaryColor }}>฿{si.totalPrice.toLocaleString()}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                      {breakdown.map(b => (
                        <span key={b.key} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: dark ? "#1a1a1a" : "#f5f5f3", border: `0.5px solid ${b.color}55`, borderRadius: 6, padding: "2px 7px", letterSpacing: 0.3 }}>
                          {b.icon} {b.qty} {typeLabel(b, lang).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {remark && (
              <>
                <div style={{ fontSize: 11, color: sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{lang === "th" ? "หมายเหตุ" : "Remark"}</div>
                <div style={{ background: card, border: `0.5px solid ${bdr}`, borderRadius: 11, padding: "12px 14px", fontSize: 12, lineHeight: 1.55, color: dark ? "#ccc" : "#444", whiteSpace: "pre-line", marginBottom: 10 }}>{remark}</div>
              </>
            )}

            <div style={{ padding: 14, background: "#2D0F1A", border: "1px solid #D4357A44", borderRadius: 11, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#D4357A", fontWeight: 600 }}>{lang === "th" ? "รวมที่จะส่งคำขอ" : "Submit total"}</span>
              <span style={{ fontSize: 18, color: "#D4357A", fontWeight: 700 }}>฿{totalValue.toLocaleString()}</span>
            </div>

            {/* Failure banner — stays on Step 4 so Sale can retry without re-entering */}
            {submitError && (
              <div style={{
                marginTop: 12, padding: "11px 13px",
                background: "#3D1212", border: "0.5px solid #7A2020",
                borderRadius: 10, color: "#F09595",
                fontSize: 12, fontWeight: 600, lineHeight: 1.55,
              }}>
                ⚠ {submitError}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom action bar */}
      <div style={{ padding: "12px 16px 16px", borderTop: `0.5px solid ${bdr}`, display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
          disabled={submitting}
          style={{ flex: 1, padding: 12, borderRadius: 12, border: `0.5px solid ${bdr}`, background: "transparent", color: sub, fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.5 : 1 }}
        >
          {step === 1 ? (lang === "th" ? "ยกเลิก" : "Cancel") : (lang === "th" ? "← กลับ" : "← Back")}
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={(step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)}
            style={{
              flex: 2, padding: 14, borderRadius: 12, border: "none",
              background: ((step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)) ? "#333" : "#D4357A",
              color: ((step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)) ? "#666" : "#fff",
              fontSize: 14, fontWeight: 700, cursor: ((step === 1 && selectedIds.size === 0) || (step === 2 && !validStep2)) ? "not-allowed" : "pointer",
            }}
          >
            {step === 1 ? (lang === "th" ? `เลือก ${selectedIds.size} รายการ →` : `Selected ${selectedIds.size} →`) : (lang === "th" ? "ถัดไป →" : "Next →")}
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              flex: 2, padding: 14, borderRadius: 12, border: "none",
              background: submitting ? "#333" : "#D4357A",
              color: submitting ? "#888" : "#fff",
              fontSize: 14, fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontFamily: "inherit",
            }}
          >
            {submitting && (
              <span style={{
                display: "inline-block", width: 14, height: 14,
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}/>
            )}
            {submitting
              ? (lang === "th" ? "กำลังบันทึก..." : "Saving...")
              : isEditing
                ? (lang === "th" ? "↩ ส่งคำขอแก้ไข" : "↩ Resubmit")
                : (lang === "th" ? "✓ ส่งคำขอ" : "✓ Submit")}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
