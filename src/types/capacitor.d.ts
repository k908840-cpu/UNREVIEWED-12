interface Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      App?: {
        addListener?: (event: string, listener: (event?: Event) => void) => Promise<{ remove?: () => void }> | { remove?: () => void };
      };
    };
  };
}
