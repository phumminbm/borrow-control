// =============================================================================
// Sidebar — v2-shell module switcher (Find Borrow / BR Return)
//
// Mirrors docs/mockups/Borrow_Mockup_Combine_Modules.html lines 750-779.
// Stateless; selected module + badge counts are owned by ShellApp.
// =============================================================================

const LABELS = {
  th: {
    section: "โมดูล",
    findBorrow: "Find Borrow",
    brReturn: "BR Return",
  },
  en: {
    section: "Modules",
    findBorrow: "Find Borrow",
    brReturn: "BR Return",
  },
};

export default function Sidebar({ module, onSelect, fbBadge, brBadge, lang }) {
  const L = LABELS[lang] || LABELS.th;

  return (
    <nav className="v2-sidebar" aria-label="Module switcher">
      <div className="v2-sb-section">{L.section}</div>

      <button
        type="button"
        className={"v2-sb-item" + (module === "fb" ? " active-fb" : "")}
        onClick={() => onSelect("fb")}
        aria-pressed={module === "fb"}
      >
        <span className="v2-sb-icon">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
        </span>
        <span className="v2-sb-item-text">{L.findBorrow}</span>
        {fbBadge != null && (
          <span className="v2-sb-item-badge">{fbBadge}</span>
        )}
      </button>

      <button
        type="button"
        className={"v2-sb-item" + (module === "br" ? " active-br" : "")}
        onClick={() => onSelect("br")}
        aria-pressed={module === "br"}
      >
        <span className="v2-sb-icon">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14l-4-4 4-4" />
            <path d="M5 10h11a4 4 0 010 8h-1" />
          </svg>
        </span>
        <span className="v2-sb-item-text">{L.brReturn}</span>
        {brBadge != null && (
          <span className="v2-sb-item-badge">{brBadge}</span>
        )}
      </button>

      <div className="v2-sb-spacer" />
    </nav>
  );
}
