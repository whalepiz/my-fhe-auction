// src/lib/fhe.ts
// Tải Relayer SDK từ CDN bằng dynamic import (ESM) với nhiều fallback.
// Không import package cục bộ, không chèn <script>.

let _sdkPromise: Promise<any> | null = null;
let _instPromise: Promise<any> | null = null;

async function loadRelayerSDK() {
  if (_sdkPromise) return _sdkPromise;

  _sdkPromise = (async () => {
    const candidates = [
      // jsDelivr ESM
      "https://cdn.jsdelivr.net/npm/@zama-fhe/relayer-sdk/+esm",
      // esm.sh CDN
      "https://esm.sh/@zama-fhe/relayer-sdk",
      // unpkg ESM
      "https://unpkg.com/@zama-fhe/relayer-sdk?module",
    ];

    for (const url of candidates) {
      try {
        // @vite-ignore để Vite không prebundle URL ngoài
        const mod: any = await import(/* @vite-ignore */ url);
        return mod;
      } catch {
        // thử URL tiếp theo
      }
    }
    throw new Error("Failed to load Relayer SDK from CDN");
  })();

  return _sdkPromise;
}

export async function getFheInstance() {
  if (_instPromise) return _instPromise;

  _instPromise = (async () => {
    const mod: any = await loadRelayerSDK();

    // Tự tương thích cả named lẫn default export
    const initSDK = mod?.initSDK || mod?.default?.initSDK;
    const createInstance = mod?.createInstance || mod?.default?.createInstance;
    const SepoliaConfig = mod?.SepoliaConfig || mod?.default?.SepoliaConfig;

    if (typeof initSDK === "function") {
      await initSDK();
    }
    if (!createInstance || !SepoliaConfig) {
      throw new Error("Relayer SDK missing createInstance/SepoliaConfig after load");
    }

    return createInstance(SepoliaConfig);
  })();

  return _instPromise;
}
