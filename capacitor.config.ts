import type { CapacitorConfig } from '@capacitor/cli';

// The package ID is intentionally stable. Confirm its availability in Google
// Play Console before the first uploaded release; it cannot be changed later.
const config: CapacitorConfig = {
  appId: 'app.unreviewed.game',
  appName: 'UNREVIEWED',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
