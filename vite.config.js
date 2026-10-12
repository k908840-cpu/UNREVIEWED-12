import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

// Non-secret build identity for diagnostics (see src/lib/build-info.js).
function resolveCommit() {
  const fromEnv = process.env.VITE_BUILD_ID || process.env.GITHUB_SHA || process.env.COMMIT_SHA;
  if (fromEnv) return String(fromEnv).slice(0, 12);
  try { return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'; }
  catch { return 'unknown'; }
}
const APP_BUILD = { commit: resolveCommit(), builtAt: new Date().toISOString() };

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(APP_BUILD) },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});
