import { useState } from "react";
import SaleView from "../find-br/SaleView";
import AdminView from "../find-br/AdminView";
import useFindBrData from "../find-br/useFindBrData";
import { T } from "../../App";

// =============================================================================
// FBPanel — Find Borrow module panel.
//
// Mounts SaleView and AdminView with a Sale / Admin tab switch inside the
// v2-shell. Hides the legacy DesktopApp chrome (navbar, version chip) because
// the v2 shell topbar already covers that role.
//
// Receives theme + lang from ShellApp (single source of truth). Internally
// owns only the Sale|Admin view tab state.
// =============================================================================

const PAGE_HEADER = {
  th: {
    eyebrow: "FIND BORROW",
    title: "ค้นหาใบยืม (Find Borrow)",
    subtitle: "ค้นหาและติดตามใบยืม BR · วิเคราะห์สถานะการยืมสินค้าของลูกค้า",
    sale: "Sale",
    admin: "Admin",
    live: "PRODUCTION",
    loading: "กำลังโหลดข้อมูล...",
  },
  en: {
    eyebrow: "FIND BORROW",
    title: "Find Borrow",
    subtitle: "Borrowing overview — by customer, BR, outstanding value",
    sale: "Sale",
    admin: "Admin",
    live: "PRODUCTION",
    loading: "Loading...",
  },
};

export default function FBPanel({ theme, lang }) {
  const [view, setView] = useState("sale");
  const { customers, syncLogs, syncHealth, analytics, custValues, loading } = useFindBrData();
  const L  = PAGE_HEADER[lang] || PAGE_HEADER.th;
  const dark = theme === "dark";

  return (
    <section className="v2-module-panel active" aria-label="Find Borrow module">
      {/* Page header */}
      <div className="v2-page-header">
        <div>
          <div className="v2-page-header-eyebrow fb">{L.eyebrow}</div>
          <h1 className="v2-page-header-h1">
            {L.title}
            <span className="v2-page-header-badge live">
              <span className="v2-pill-dot" style={{ background: "#639922" }} />
              {L.live}
            </span>
          </h1>
          <p className="v2-page-header-p">{L.subtitle}</p>
        </div>
      </div>

      {/* Tab bar (Sale | Admin) */}
      <div className="v2-tabbar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "sale"}
          className={"v2-tab-btn" + (view === "sale" ? " active-fb" : "")}
          onClick={() => setView("sale")}
        >
          <span className="v2-tab-dot" style={{ background: "#378ADD" }} />
          {L.sale}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "admin"}
          className={"v2-tab-btn" + (view === "admin" ? " active-admin" : "")}
          onClick={() => setView("admin")}
        >
          <span className="v2-tab-dot" style={{ background: "#D4357A" }} />
          {L.admin}
        </button>
      </div>

      {/* Content */}
      <div className="v2-legacy-host">
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#888", fontSize: 13 }}>
            {L.loading}
          </div>
        ) : view === "sale" ? (
          <SaleView
            customers={customers}
            dark={dark}
            custValues={custValues}
            analytics={analytics}
            lang={lang}
          />
        ) : (
          <AdminView
            customers={customers}
            syncLogs={syncLogs}
            syncHealth={syncHealth}
            dark={dark}
            analytics={analytics}
            custValues={custValues}
            lang={lang}
          />
        )}
      </div>
    </section>
  );
}

// Suppress an unused-import warning during build: T may be referenced
// indirectly by SaleView/AdminView through their own ../../App import.
// Keeping this no-op reference here documents the relationship without
// affecting bundle size (tree-shaken).
void T;
