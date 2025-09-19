// src/lib/fhe.ts
// Nạp Relayer SDK từ CDN ở runtime -> tránh lỗi bundling/initSDK.
// Không import package vào bundle của Vite.

declare global {
  interface Window {
    RelayerSDK?: any;
  }
}

let _instPromise: Promise<any> | null = null;

async function loadRelayerSDKFromCDN() {
  // đã có thì thôi
  if (window.RelayerSDK) return;

  // jsDelivr: đổi sang unpkg cũng được. Cố định subpath "dist/bundle.min.js".
  const url = "https://cdn.jsdelivr.net/npm/@zama-fhe/relayer-sdk/dist/bundle.min.js";

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Relayer SDK from CDN"));
    document.head.appendChild(s);
  });

  if (!window.RelayerSDK) {
    throw new Error("RelayerSDK global not found after CDN load");
  }
}

export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = (async () => {
      await loadRelayerSDKFromCDN();

      const sdk = window.RelayerSDK || {};
      // Một số bản SDK có initSDK, bản khác không — gọi an toàn
      if (typeof sdk.initSDK === "function") {
        await sdk.initSDK();
      }

      const createInstance = sdk.createInstance ?? sdk.default?.createInstance;
      const SepoliaConfig = sdk.SepoliaConfig ?? sdk.default?.SepoliaConfig;

      if (!createInstance || !SepoliaConfig) {
        throw new Error("RelayerSDK not ready (createInstance/SepoliaConfig missing)");
      }
      return createInstance(SepoliaConfig);
    })();
  }
  return _instPromise;
}
