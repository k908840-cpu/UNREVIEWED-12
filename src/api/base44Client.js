import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// Native Android uses a different origin from the hosted website.
const isCapacitorNative =
  typeof window !== 'undefined' &&
  window.Capacitor?.isNativePlatform?.() === true;

export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: isCapacitorNative ? appBaseUrl : '',
  appBaseUrl
});
