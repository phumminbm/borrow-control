// =============================================================================
// TopBar — v2-shell header
//
// Mirrors docs/mockups/Borrow_Mockup_Combine_Modules.html lines 716-745.
// Stateless presentational shell; theme and lang state live in ShellApp.
// =============================================================================

export default function TopBar({ theme, lang, onToggleTheme, onToggleLang }) {
  return (
    <header className="v2-topbar">
      <div className="v2-logo-mark">N</div>
      <div className="v2-logo-text">
        <span className="v2-logo-line-1"><em>Neo</em>Biotech</span>
        <span className="v2-logo-line-2">Borrow System · v2.0</span>
      </div>
      <div className="v2-tb-spacer" />

      <button className="v2-toggle-btn" onClick={onToggleLang} title="Toggle language">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
        <span>{lang === "en" ? "EN" : "TH"}</span>
      </button>

      <button className="v2-toggle-btn" onClick={onToggleTheme} title="Toggle theme">
        {theme === "light" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M20 14a8 8 0 01-10-10 8 8 0 1010 10z" />
          </svg>
        )}
        <span>{theme === "light" ? "Light" : "Dark"}</span>
      </button>
    </header>
  );
}
