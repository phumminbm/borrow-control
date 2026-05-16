// =============================================================================
// frontend/src/i18n.js
//
// Single source of truth for every UI string in the Mobile prototype.
// Add new strings here, never inline. The audit script
// (scripts/check-i18n-coverage.js) scans every other source file for any
// Thai character (U+0E00–U+0E7F) outside this dictionary and fails the
// build if any are found — that's the mechanism that guarantees
// "no Thai UI text left when EN is selected".
//
// Customer data, BR numbers, and product names from the source data are
// NOT in this dictionary — they flow through unchanged regardless of the
// active language (Thai customer names stay Thai, etc.). Only the UI
// chrome is translated.
//
// localStorage key 'lang' is shared with Desktop (br-return.html uses
// the same key) so language preference syncs across both clients.
// =============================================================================

export const STRINGS = {
  // ── Common UI ─────────────────────────────────────────────────
  "common.cancel":           { th: "ยกเลิก",                en: "Cancel" },
  "common.confirm":          { th: "ยืนยัน",                en: "Confirm" },
  "common.save":             { th: "บันทึก",                en: "Save" },
  "common.search":           { th: "ค้นหา",                  en: "Search" },
  "common.close":            { th: "ปิด",                   en: "Close" },
  "common.back":             { th: "ย้อนกลับ",               en: "Back" },
  "common.next":             { th: "ถัดไป",                 en: "Next" },
  "common.submit":           { th: "ส่ง",                   en: "Submit" },
  "common.loading":          { th: "กำลังโหลด...",          en: "Loading..." },
  "common.all":              { th: "ทั้งหมด",                en: "All" },
  "common.clear":            { th: "ล้าง",                  en: "Clear" },
  "common.delete":           { th: "ลบ",                    en: "Delete" },
  "common.edit":             { th: "แก้ไข",                 en: "Edit" },
  "common.add":              { th: "เพิ่ม",                  en: "Add" },
  "common.refresh":          { th: "รีเฟรช",                en: "Refresh" },
  "common.today":            { th: "วันนี้",                 en: "Today" },
  "common.yesterday":        { th: "เมื่อวาน",               en: "Yesterday" },
  "common.thisWeek":         { th: "สัปดาห์นี้",             en: "This week" },
  "common.thisMonth":        { th: "เดือนนี้",              en: "This month" },
  "common.date":             { th: "วันที่",                 en: "Date" },
  "common.note":             { th: "หมายเหตุ",              en: "Note" },
  "common.reason":           { th: "เหตุผล",                en: "Reason" },
  "common.status":           { th: "สถานะ",                 en: "Status" },
  "common.items":            { th: "รายการ",                en: "items" },
  "common.itemsCount":       { th: "{n} รายการ",            en: "{n} item(s)" },
  "common.qty":              { th: "จำนวน",                 en: "Qty" },
  "common.pieces":           { th: "ชิ้น",                   en: "pcs" },
  "common.price":            { th: "ราคา",                  en: "Price" },
  "common.total":            { th: "รวม",                   en: "Total" },
  "common.grandTotal":       { th: "รวมทั้งหมด",            en: "Grand total" },
  "common.subtotalShown":    { th: "รวมรายการที่แสดง",      en: "Subtotal (shown)" },
  "common.success":          { th: "สำเร็จ",                en: "Success" },
  "common.failed":           { th: "ล้มเหลว",                en: "Failed" },
  "common.results":          { th: "ผลลัพธ์",               en: "results" },
  "common.processing":       { th: "กำลังประมวลผล...",      en: "Processing..." },
  "common.tryAgain":         { th: "ลองอีกครั้ง",            en: "Try again" },
  "common.day":              { th: "วัน",                   en: "day" },
  "common.days":             { th: "วัน",                   en: "days" },
  "common.daysMax":          { th: "วันค้างสูงสุด",         en: "Max days" },
  "common.value":            { th: "มูลค่า",                en: "Value" },
  "common.available":        { th: "มีอยู่",                en: "Available" },
  "common.remaining":        { th: "เหลือ",                 en: "Remaining" },
  "common.saving":           { th: "กำลังบันทึก...",        en: "Saving..." },

  // ── Tabs ──────────────────────────────────────────────────────
  "tab.home":                { th: "หน้าหลัก",              en: "Home" },
  "tab.customers":           { th: "ลูกค้า",                en: "Customers" },
  "tab.returns":             { th: "คืนสินค้า",             en: "Returns" },
  "tab.alerts":              { th: "แจ้งเตือน",             en: "Alerts" },
  "tab.profile":             { th: "โปรไฟล์",               en: "Profile" },

  // ── Status taxonomy ───────────────────────────────────────────
  "status.pending":          { th: "รอตรวจสอบคำขอ",         en: "Pending review" },
  "status.pending.short":    { th: "รอตรวจสอบ",             en: "Pending" },
  "status.approved":         { th: "อนุมัติแล้ว",           en: "Approved" },
  "status.rejected":         { th: "แก้ไขคำขอ",             en: "Needs revision" },
  "status.rejected.short":   { th: "แก้ไขคำขอ",             en: "Needs revision" },
  "status.cancelled":        { th: "ยกเลิกแล้ว",            en: "Cancelled" },

  // ── Return-type labels ────────────────────────────────────────
  "type.return":             { th: "คืน",                   en: "Return" },
  "type.claim":              { th: "เคลม",                  en: "Claim" },
  "type.sale":               { th: "ขาย",                   en: "Sale" },
  "type.free":               { th: "ฟรี",                   en: "Free" },

  // ── Sale picker ───────────────────────────────────────────────
  "sale.picker.title":       { th: "เลือกชื่อ Sale ของคุณ", en: "Choose your Sale name" },
  "sale.picker.subtitle":    { th: "Prototype — ทดลอง BR Return mobile flow", en: "Prototype — testing the mobile BR Return flow" },
  "sale.picker.continue":    { th: "เข้าใช้งาน",            en: "Continue" },

  // ── Home screen ───────────────────────────────────────────────
  "home.outstanding":        { th: "ยอดค้างชำระ",            en: "Outstanding" },
  "home.activeBR":           { th: "BR Active",             en: "Active BR" },
  "home.critical":           { th: "ลูกค้าเร่งด่วน",         en: "Critical customers" },
  "home.lastSync":           { th: "Sync ล่าสุด",            en: "Last sync" },
  "home.viewAll":            { th: "ดูทั้งหมด →",            en: "View all →" },
  "home.alertCard":          { th: "ลูกค้าที่ต้องดูแล",      en: "Customers needing attention" },
  "home.quickActions":       { th: "ทางลัด",                 en: "Quick actions" },

  // ── Customers list ────────────────────────────────────────────
  "cust.title":              { th: "รายชื่อลูกค้า",          en: "Customers" },
  "cust.searchPlaceholder":  { th: "ค้นหาชื่อ / รหัสลูกค้า", en: "Search name / code" },
  "cust.sortBy":             { th: "เรียงโดย",              en: "Sort by" },
  "cust.sort.days":          { th: "วันค้าง",                en: "Days" },
  "cust.sort.value":         { th: "มูลค่า",                en: "Value" },
  "cust.sort.name":          { th: "ชื่อ",                   en: "Name" },
  "cust.team":               { th: "ทีม",                   en: "Team" },
  "cust.salePerson":         { th: "Sale",                  en: "Sale" },
  "cust.detail":             { th: "ข้อมูลลูกค้า",          en: "Customer info" },
  "cust.brList":             { th: "รายการใบยืม",            en: "BR list" },
  "cust.brSearchPlaceholder":{ th: "ค้นหาเลขใบยืม",          en: "Search BR number" },
  "cust.noBR":               { th: "ลูกค้านี้ไม่มีใบยืม",   en: "No BRs for this customer" },

  // ── BR detail ─────────────────────────────────────────────────
  "br.detail.title":         { th: "รายละเอียดใบยืม",       en: "BR detail" },
  "br.detail.daysOut":       { th: "วันค้าง",                en: "Days out" },
  "br.detail.borrowDate":    { th: "วันที่ยืม",              en: "Borrow date" },
  "br.detail.items":         { th: "รายการสินค้า",          en: "Items" },
  "br.detail.requestReturn": { th: "ขอคืนสินค้า",            en: "Request return" },
  "br.detail.exportPDF":     { th: "Export PDF",            en: "Export PDF" },

  // ── Request return flow (4 steps) ─────────────────────────────
  "req.title":               { th: "ขอคืนสินค้า",            en: "Request return" },
  "req.editTitle":           { th: "📝 แก้ไขคำขอ",          en: "📝 Edit request" },
  "req.step.select":         { th: "เลือก",                  en: "Select" },
  "req.step.quantity":       { th: "จำนวน",                  en: "Quantity" },
  "req.step.remark":         { th: "หมายเหตุ",              en: "Remark" },
  "req.step.review":         { th: "ตรวจสอบ",               en: "Review" },
  "req.cancel":              { th: "ยกเลิก",                en: "Cancel" },
  "req.backStep":            { th: "← กลับ",                 en: "← Back" },
  "req.nextStep":            { th: "ถัดไป →",               en: "Next →" },
  "req.selectedCount":       { th: "เลือก {n} รายการ →",    en: "Selected {n} →" },
  "req.submit":              { th: "✓ ส่งคำขอ",             en: "✓ Submit" },
  "req.resubmit":            { th: "↩ ส่งคำขอแก้ไข",         en: "↩ Resubmit" },
  "req.savingBtn":           { th: "กำลังบันทึก...",        en: "Saving..." },
  "req.submitFail":          { th: "บันทึกคำขอไม่สำเร็จ ลองอีกครั้ง", en: "Submit failed — please retry" },
  "req.submitFailWithMsg":   { th: "บันทึกคำขอไม่สำเร็จ — {err}", en: "Submit failed — {err}" },
  "req.section.selectItems": { th: "เลือกรายการที่จะคืน",   en: "Select items to return" },
  "req.section.itemsToFix":  { th: "ส่วนที่ต้องแก้ไข",       en: "Items to revise" },
  "req.section.allocateQty": { th: "ระบุจำนวนแยกประเภท",    en: "Allocate quantity per type" },
  "req.allocateHint":        { th: "แบ่งจำนวนได้หลายประเภทต่อรายการ (RETURN / CLAIM / SALE / FREE) รวมกันไม่เกินจำนวนที่มีอยู่", en: "Split each item across multiple types (RETURN / CLAIM / SALE / FREE). The combined quantity must not exceed available." },
  "req.selectAllAs":         { th: "เลือกทั้งหมดเป็น",      en: "Select all as" },
  "req.selectAll":           { th: "เลือกทั้งหมด",          en: "Select all" },
  "req.clearAll":            { th: "ล้างการเลือก",          en: "Clear all" },
  "req.remarkPlaceholder":   { th: "ระบุรายละเอียดที่ Admin ควรทราบ...", en: "Add any details Admin should know..." },
  "req.remarkMaxReached":    { th: "ครบ 500 อักษรแล้ว",     en: "500 character limit reached" },
  "req.itemsToSubmit":       { th: "รายการที่จะส่ง",         en: "Items to submit" },
  "req.reviewBeforeSubmit":  { th: "ตรวจสอบก่อนส่ง",        en: "Review before submit" },
  "req.submitTotal":         { th: "รวมที่จะส่งคำขอ",       en: "Submit total" },
  "req.testWarning":         { th: "Test Mode: คำขอจะส่งให้ Backend ด้วย isTest=true และไปแสดงที่ Desktop Admin (🧪 TEST queue) — ไม่กระทบข้อมูล Logistics File", en: "Test mode: the request POSTs to backend with isTest=true and appears in the Desktop Admin (🧪 TEST queue) — Logistics File is not touched" },
  "req.tag.needsRevision":   { th: "ต้องแก้ไข",             en: "Revise" },
  "req.tag.approvedKept":    { th: "อนุมัติแล้ว (คงเดิม)",  en: "Approved (kept)" },

  // ── Editing-mode banners (Step 1 + Step 4) ────────────────────
  "req.edit.bannerLabel":    { th: "กำลังแก้ไขคำขอ",        en: "Editing request" },
  "req.edit.banner.step1":   { th: "แก้ไขเฉพาะรายการที่ Admin ขอแก้ {n} รายการ — รายการอื่นจะคงเดิม", en: "Editing only the {n} item(s) Admin flagged — the rest are kept as-is" },
  "req.edit.banner.step4":   { th: "{a} รายการที่ Admin อนุมัติแล้วจะคงเดิม · {n} รายการแก้ไขใหม่จะถูกส่งให้ Admin ตรวจอีกครั้ง", en: "{a} approved item(s) will be kept · {n} revised item(s) will be sent to Admin for review" },
  "req.edit.adminNote":      { th: "หมายเหตุ Admin: ",      en: "Admin note: " },

  // ── Submit empty / loading states ─────────────────────────────
  "empty.noItemsInBR":       { th: "ไม่มีรายการในใบยืมนี้",  en: "No items in this BR" },
  "empty.loading":           { th: "กำลังโหลดข้อมูล...",    en: "Loading..." },
  "empty.noReturns":         { th: "ยังไม่มีคำขอคืนสินค้า\nเข้าไปที่ BR Detail แล้วกด ขอคืนสินค้า", en: "No return requests yet.\nOpen a BR detail and tap Request return." },
  "empty.noFilterMatch":     { th: "ไม่พบรายการที่ตรงกับตัวกรอง", en: "No matching results" },
  "empty.noScopeMatch":      { th: "ไม่มีรายการที่ตรงเงื่อนไข", en: "No items in scope" },

  // ── Returns history page ──────────────────────────────────────
  "returns.searchPlaceholder": { th: "ค้นหา RT / ลูกค้า / BR...", en: "Search RT / customer / BR..." },
  "returns.anyDate":         { th: "ทุกวันที่",              en: "Any date" },
  "returns.clearFilter":     { th: "ล้างตัวกรอง",            en: "Clear filter" },
  "returns.hintProto":       { th: "แตะค้างเพื่อจำลองสถานะ Admin", en: "Long-press to simulate Admin" },
  "returns.hintTest":        { th: "🧪 เชื่อม Backend จริง — Admin ใช้งาน Desktop", en: "🧪 Connected to real backend — Admin uses Desktop" },
  "returns.needsRevisionTitle":{ th: "ต้องแก้ไข",            en: "Needs revision" },
  "returns.itemsCount":      { th: "{n} รายการ",            en: "{n} item(s)" },
  "returns.revBadge":        { th: "แก้ไขครั้งที่ {n}",      en: "Rev {n}" },
  "returns.reviseLabel":     { th: "ขอแก้ไข",                en: "Revise" },

  // ── Return detail sheet ───────────────────────────────────────
  "detail.title":            { th: "รายละเอียดคำขอ",        en: "Return detail" },
  "detail.requestId":        { th: "เลขที่คำขอ",            en: "Request ID" },
  "detail.section.custBR":   { th: "ลูกค้า / BR",            en: "Customer / BR" },
  "detail.section.itemsRevise":{ th: "รายการที่ต้องแก้ไข",   en: "Items to revise" },
  "detail.section.itemsRevised":{ th: "รายการที่แก้ไขใหม่",  en: "Revised items" },
  "detail.section.itemsAllApproved":{ th: "รายการที่อนุมัติทั้งหมด", en: "All approved items" },
  "detail.section.items":    { th: "รายการ",                en: "Items" },
  "detail.section.remark":   { th: "หมายเหตุ",              en: "Remark" },
  "detail.section.cancelReason":{ th: "เหตุผลที่ยกเลิก",    en: "Cancel reason" },
  "detail.section.adminEvidence":{ th: "หลักฐานจาก Admin ({n})", en: "Admin evidence ({n})" },
  "detail.banner.needsRevision":{ th: "มีรายการที่ต้องแก้ไข", en: "Items need revision" },
  "detail.banner.adminNote": { th: "หมายเหตุ Admin: ",      en: "Admin note: " },
  "detail.editResubmit":     { th: "↩ แก้ไขและส่งใหม่",     en: "↩ Edit and resubmit" },
  "detail.simulateAdmin":    { th: "จำลองสถานะ Admin (Prototype)", en: "Simulate Admin status (Prototype)" },
  "detail.testModeAdmin":    { th: "โหมดทดสอบ — ให้ Admin บน Desktop เปิด /br-return ดูคำขอนี้", en: "Test mode — review this on Desktop Admin /br-return" },
  "detail.resubmittedAt":    { th: "ส่งแก้ไขเมื่อ",          en: "Resubmitted" },
  "detail.approvedKeep":     { th: "ซ่อนรายการที่อนุมัติแล้ว", en: "Approved items hidden" },
  "detail.includesRevised":  { th: "รวมรายการที่ผ่านการแก้ไขด้วย", en: "Includes corrected versions" },
  "detail.latestOnly":       { th: "เฉพาะรายการที่แก้ไขรอบล่าสุด", en: "Latest-revision items only" },

  // ── Admin sim ─────────────────────────────────────────────────
  "sim.title":               { th: "จำลองสถานะ Admin (Prototype)", en: "Simulate Admin status (Prototype)" },
  "sim.subtitle":            { th: "เครื่องมือ prototype-only — ใช้ดูว่า Sale-side UI ตอบสนองยังไงกับแต่ละสถานะ Admin", en: "Prototype-only tool — preview how the Sale-side UI reacts to each Admin status" },
  "sim.current":             { th: "ปัจจุบัน",               en: "current" },
  "sim.opensComposer":       { th: "เปิดตัวแก้คำขอ",         en: "opens composer" },
  "sim.deleteReq":           { th: "ลบคำขอ (เฉพาะ prototype)", en: "Delete request (prototype only)" },

  // ── Admin feedback composer ───────────────────────────────────
  "composer.title":          { th: "🎭 จำลอง Admin · ส่งกลับแก้ไข", en: "🎭 Sim Admin · send back" },
  "composer.selectItems":    { th: "เลือกรายการที่ต้องแก้ ({n}/{total})", en: "Pick items to flag ({n}/{total})" },
  "composer.noItems":        { th: "คำขอนี้ไม่มีรายการ",    en: "This request has no items" },
  "composer.itemReasonPlaceholder": { th: "ระบุเหตุผลที่ต้องแก้ไข...", en: "Reason this item needs revision..." },
  "composer.adminRemarkLabel":{ th: "หมายเหตุ Admin (ทั้งคำขอ)", en: "Admin remark (whole request)" },
  "composer.adminRemarkPlaceholder":{ th: "ระบุภาพรวมที่ Sale ต้องแก้ไข...", en: "Overall message for Sale..." },
  "composer.evidenceLabel":  { th: "หลักฐาน ({n}/{max})",   en: "Evidence ({n}/{max})" },
  "composer.pickImage":      { th: "เลือกรูป",               en: "Pick image" },
  "composer.demoPhoto":      { th: "รูปจำลอง",               en: "Demo photo" },
  "composer.maxPhotos":      { th: "แนบได้สูงสุด {n} รูปต่อคำขอ", en: "Max {n} photos per request" },
  "composer.fileBad":        { th: "ไฟล์ \"{name}\" ใช้ไม่ได้", en: "Could not process \"{name}\"" },
  "composer.atLeastOne":     { th: "เลือกอย่างน้อย 1 รายการที่ต้องแก้", en: "Pick at least one item to flag" },
  "composer.storageFull":    { th: "พื้นที่ไม่พอ ลดรูปหรือลบรูปก่อน", en: "Storage full — remove a photo or reduce size" },
  "composer.protoWarning":   { th: "Prototype: รูปและหมายเหตุนี้เก็บใน localStorage บนเครื่องเท่านั้น — ไม่ส่งไป Admin/Database จริง", en: "Prototype: photos and notes are stored locally only — not sent to real Admin/Database" },
  "composer.sendBack":       { th: "ส่งกลับให้ Sale ({n})", en: "Send back to Sale ({n})" },
  "composer.reason":         { th: "เหตุผล: ",              en: "Reason: " },

  // ── Submit success screen ─────────────────────────────────────
  "success.title":           { th: "ส่งคำขอสำเร็จ",          en: "Submitted successfully" },
  "success.body":            { th: "คำขอของคุณถูกบันทึกแล้ว Admin จะตรวจสอบและอนุมัติให้\nสามารถดูสถานะได้ที่แท็บ Returns", en: "Your request has been saved. Admin will review and approve it.\nTrack its status under the Returns tab." },
  "success.requestId":       { th: "เลขที่คำขอ",             en: "Request ID" },
  "success.nextSteps":       { th: "ขั้นถัดไป",              en: "Next steps" },
  "success.nextStepsBody":   { th: "Admin จะอนุมัติและระบบจะ Sync กับ Logistics File โดยอัตโนมัติ การเปลี่ยนแปลงจะปรากฏใน Dashboard ในรอบ snapshot คืนถัดไป (~23:30)", en: "Admin will approve and the system syncs to the Logistics File automatically. Changes appear in the Dashboard in the next nightly snapshot (~23:30)." },
  "success.adminReview":     { th: "Admin ตรวจสอบ",          en: "Admin review" },
  "success.sheetSync":       { th: "Sheet sync",            en: "Sheet sync" },
  "success.backToBRList":    { th: "กลับไปเลือก BR",         en: "Back to BR list" },
  "success.viewAllRequests": { th: "ดูคำขอทั้งหมด →",        en: "View all requests →" },
  "success.editSent":        { th: "ส่งคำขอแก้ไขสำเร็จ",    en: "Resubmitted successfully" },

  // ── Toasts ────────────────────────────────────────────────────
  "toast.backendPostFail":   { th: "บันทึกคำขอลง backend ไม่สำเร็จ", en: "Could not save request to backend" },
  "toast.backendUpdateFail": { th: "อัปเดตคำขอลง backend ไม่สำเร็จ", en: "Could not update request on backend" },

  // ── Profile ───────────────────────────────────────────────────
  "profile.salePerson":      { th: "Sale",                  en: "Sale" },
  "profile.team":            { th: "ทีม",                   en: "Team" },
  "profile.theme":           { th: "ธีม",                   en: "Theme" },
  "profile.language":        { th: "ภาษา",                  en: "Language" },
  "profile.darkMode":        { th: "โหมดมืด",                en: "Dark mode" },
  "profile.lightMode":       { th: "โหมดสว่าง",              en: "Light mode" },
  "profile.changeSale":      { th: "เปลี่ยน Sale",           en: "Change Sale" },
  "profile.signOut":         { th: "ออกจากระบบ",            en: "Sign out" },
  "profile.aboutVersion":    { th: "เกี่ยวกับเวอร์ชัน",      en: "About version" },

  // ── Date picker ───────────────────────────────────────────────
  "date.selectDate":         { th: "เลือกวันที่",            en: "Select date" },
  "date.from":               { th: "เริ่มต้น",               en: "From" },
  "date.to":                 { th: "สิ้นสุด",                en: "To" },
  "date.selectDay":          { th: "เลือกวัน",               en: "Select day" },
  "date.applyDays":          { th: "ตกลง ({n} วัน)",         en: "Apply ({n} days)" },
  "date.applyOne":           { th: "ตกลง ({d})",             en: "Apply ({d})" },
  "date.daySingular":        { th: "วัน",                   en: "day" },

  // ── Prototype badge ───────────────────────────────────────────
  "badge.prototype":         { th: "Prototype",              en: "Prototype" },
  "badge.test":              { th: "Test",                  en: "Test" },
};

// Translate. Falls back to the literal key when missing so unknown
// strings surface visibly during development. Supports {placeholder}
// substitution: t('common.itemsCount', {n: 3}, 'en') → "3 item(s)".
export function t(key, vars, lang) {
  // Allow t(key, lang) shorthand when vars is omitted
  if (typeof vars === "string" && lang === undefined) { lang = vars; vars = null; }
  const use = lang || getCurrentLang();
  const entry = STRINGS[key];
  let raw = entry ? (entry[use] || entry.th || key) : key;
  if (vars) {
    for (const k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        raw = raw.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
      }
    }
  }
  return raw;
}

// Language state. Reads from localStorage on first call. Mobile already
// uses the 'lang' key, Desktop uses the same key — they stay in sync.
let _currentLang = null;
export function getCurrentLang() {
  if (_currentLang) return _currentLang;
  try { _currentLang = localStorage.getItem("lang") || "th"; }
  catch { _currentLang = "th"; }
  return _currentLang;
}
export function setCurrentLang(lang) {
  if (lang !== "th" && lang !== "en") return;
  _currentLang = lang;
  try { localStorage.setItem("lang", lang); } catch {}
}
