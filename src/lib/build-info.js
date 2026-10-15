// Lightweight build identification for diagnostics. No secrets: only a commit
// id, a build timestamp, and the backend revision this bundle expects.
// @ts-ignore -- shared with the Deno backend, which requires the .ts extension
import { BACKEND_BUILD_ID, BACKEND_BUILD_HEADER } from "../../base44/shared/build.ts";
import { normalizeFunctionResponse } from "../api/functionResponse.js";

/* global __APP_BUILD__ */
// @ts-ignore -- injected by vite `define` (vite.config.js)
const injected = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : null;

export const FRONTEND_BUILD = Object.freeze({
  commit: injected?.commit || "unknown",
  builtAt: injected?.builtAt || "unknown",
});
export const EXPECTED_BACKEND_BUILD = BACKEND_BUILD_ID;

const diag = { frontend: FRONTEND_BUILD, expectedBackend: EXPECTED_BACKEND_BUILD, backend: null, backendMatches: null };

// Record the backend build reported by a function response (body field `build`,
// or the response header). Never throws.
export function noteBackendBuild(res) {
  try {
    const reported = normalizeFunctionResponse(res).build
      || res?.headers?.[BACKEND_BUILD_HEADER]
      || res?.headers?.get?.(BACKEND_BUILD_HEADER);
    if (typeof reported === "string" && reported && reported !== diag.backend) {
      diag.backend = reported;
      diag.backendMatches = reported === EXPECTED_BACKEND_BUILD;
      if (!diag.backendMatches) console.warn("[unreviewed] backend build differs from this bundle", { ...diag });
    }
  } catch { /* diagnostics must never affect gameplay */ }
}

export function installBuildDiagnostics() {
  try {
    // @ts-ignore -- diagnostics handle for support/debugging
    if (typeof window !== "undefined") window.__UNREVIEWED_BUILD__ = diag;
    console.info(`[unreviewed] frontend ${FRONTEND_BUILD.commit} (${FRONTEND_BUILD.builtAt}), expects backend ${EXPECTED_BACKEND_BUILD}`);
  } catch { /* ignore */ }
}
