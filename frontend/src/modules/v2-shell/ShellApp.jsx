import { useEffect, useState } from "react";
import "./shellTokens.css";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import FBPanel from "./FBPanel";
import BRPanel from "./BRPanel";

// =============================================================================
// ShellApp — top-level v2 shell that hosts both Find Borrow and BR Return.
//
// Activation: reached via /v2 path or ?v=2 query flag.
//
// State owned here:
//   • theme  (dark | light)  — persisted to BOTH localStorage['theme'] (React
//     side) AND localStorage['br-theme'] (BR Return side) on every change.
//   • lang   (th  | en)      — persisted to localStorage['lang'] only; that
//     key is already shared by both sides.
//   • module (fb  | br)      — which sidebar module is active.
//   • brBadge (number|null)  — pending-count badge for BR Return sidebar;
//     updated via postMessage from the iframe.
//
// Theme/lang propagation:
//   • Find BR side (mounted React tree)   → reads from props (theme, lang)
//   • BR Return iframe (cross-origin)     → notified via window.postMessage
// =============================================================================

const THEME_KEY_REACT = "theme";
const THEME_KEY_BR    = "br-theme";
const LANG_KEY        = "lang"; // shared between React and BR Return

function readTheme() {
  try {
    // Prefer the React key; fall back to BR key; default dark to match
    // the existing production default.
    const r = localStorage.getItem(THEME_KEY_REACT);
    if (r === "dark" || r === "light") return r;
    const b = localStorage.getItem(THEME_KEY_BR);
    if (b === "dark" || b === "light") return b;
  } catch {}
  return "dark";
}

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "th" || v === "en") return v;
  } catch {}
  return "th";
}

export default function ShellApp() {
  const [theme, setTheme]   = useState(readTheme);
  const [lang, setLang]     = useState(readLang);
  const [module, setModule] = useState("fb");
  const [brBadge, setBrBadge] = useState(null);

  // Persist theme to both keys + toggle the document class for any
  // theme-aware CSS (including Find BR side that may read .light).
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY_REACT, theme);
      localStorage.setItem(THEME_KEY_BR, theme);
    } catch {}
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("v2-light");
      root.classList.add("light");
    } else {
      root.classList.remove("v2-light");
      root.classList.remove("light");
    }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
  }, [lang]);

  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  const toggleLang  = () => setLang(l => (l === "th" ? "en" : "th"));

  return (
    <div className="v2-app">
      <TopBar
        theme={theme}
        lang={lang}
        onToggleTheme={toggleTheme}
        onToggleLang={toggleLang}
      />

      <div className="v2-main">
        <Sidebar
          module={module}
          onSelect={setModule}
          fbBadge={null}
          brBadge={brBadge}
          lang={lang}
        />

        <div className="v2-content">
          {/* Both panels are mounted at all times so that:
              1. Find BR data keeps polling in the background
              2. The BR Return iframe doesn't reload when switching modules
             The inactive panel is hidden via display:none via the
             .v2-module-panel rule (only .active is shown). */}
          <div style={{ display: module === "fb" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
            <FBPanel theme={theme} lang={lang} />
          </div>
          <div style={{ display: module === "br" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
            <BRPanel
              theme={theme}
              lang={lang}
              onPendingCount={setBrBadge}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
