import { useState, useEffect } from "react";

// =============================================================================
// useFindBrData — shared data-fetching hook for the Find BR module.
//
// This hook centralizes the same fetch flow that DesktopApp inlines in
// frontend/src/App.jsx. It is used by the v2-shell FBPanel so the new shell
// doesn't have to duplicate that logic.
//
// DesktopApp (the legacy `?legacy=1` route) intentionally does NOT use this
// hook — it stays byte-identical to preserve a clean, provable rollback
// path. The mild duplication is acceptable until Phase 6 when DesktopApp
// retires.
//
// All endpoints called here are READ-ONLY. The hook never writes to the
// backend, never touches localStorage outside its own cache, never calls
// the Apps Script.
// =============================================================================

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const FB_DATA_CACHE = "borrow-control:v2-findbr-cache";

function readCache() {
  try { return JSON.parse(localStorage.getItem(FB_DATA_CACHE) || "null") || {}; }
  catch { return {}; }
}

function writeCache(data) {
  try { localStorage.setItem(FB_DATA_CACHE, JSON.stringify({ ...data, savedAt: Date.now() })); }
  catch {}
}

async function fetchJson(path, retries = 1) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return await res.json();
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 700));
      return fetchJson(path, retries - 1);
    }
    throw err;
  }
}

export default function useFindBrData() {
  const cached = readCache();
  const [customers, setCustomers]   = useState(() => Array.isArray(cached.customers) ? cached.customers : []);
  const [syncLogs, setSyncLogs]     = useState(() => Array.isArray(cached.syncLogs) ? cached.syncLogs : []);
  const [syncHealth, setSyncHealth] = useState(() => cached.syncHealth || null);
  const [analytics, setAnalytics]   = useState(() => cached.analytics || null);
  const [custValues, setCustValues] = useState(() => cached.custValues || {});
  const [loading, setLoading]       = useState(() => !(Array.isArray(cached.customers) && cached.customers.length > 0));

  useEffect(() => {
    const load = () => {
      Promise.allSettled([
        fetchJson("/customers", 2),
        fetchJson("/sync-logs", 1),
        fetchJson("/analytics/summary", 1),
        fetchJson("/analytics/customer-value", 1),
        fetchJson("/sync-health", 1),
      ]).then(results => {
        const custs  = results[0].status === "fulfilled" ? results[0].value : null;
        const logs   = results[1].status === "fulfilled" ? results[1].value : null;
        const anal   = results[2].status === "fulfilled" ? results[2].value : null;
        const cv     = results[3].status === "fulfilled" ? results[3].value : null;
        const health = results[4].status === "fulfilled" ? results[4].value : null;

        const nextCache = readCache();
        if (Array.isArray(custs) && custs.length > 0) { setCustomers(custs); nextCache.customers = custs; }
        if (Array.isArray(logs))                       { setSyncLogs(logs);  nextCache.syncLogs  = logs;  }
        if (anal   && !anal.error)                     { setAnalytics(anal); nextCache.analytics = anal;  }
        if (cv     && !cv.error)                       { setCustValues(cv);  nextCache.custValues = cv;   }
        if (health && !health.error)                   { setSyncHealth(health); nextCache.syncHealth = health; }
        writeCache(nextCache);
      }).finally(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { customers, syncLogs, syncHealth, analytics, custValues, loading };
}
