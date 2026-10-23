import { mock } from "bun:test";

/**
 * Test-environment shims: react-native and AsyncStorage are replaced so the
 * pure modules (crypto, i18n, sheets) can run under `bun test` outside Metro.
 */
const mem = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string): Promise<string | null> => mem.get(k) ?? null,
    setItem: async (k: string, v: string): Promise<void> => {
      mem.set(k, v);
    },
    removeItem: async (k: string): Promise<void> => {
      mem.delete(k);
    },
  },
}));

mock.module("react-native", () => ({
  I18nManager: { allowRTL: () => {}, forceRTL: () => {} },
  default: {},
}));

// NetInfo's native module doesn't exist outside a real app runtime.
mock.module("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (_cb: unknown): (() => void) => () => {},
    fetch: async (): Promise<{ isInternetReachable: boolean | null }> => ({ isInternetReachable: true }),
  },
}));
