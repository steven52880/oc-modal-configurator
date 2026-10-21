/// <reference types="vite/client" />

interface Window {
  pywebview?: {
    api: Record<string, (...args: unknown[]) => Promise<import("./types/domain").Envelope<unknown>>>;
  };
}
