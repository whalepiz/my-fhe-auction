// src/lib/fhe.ts
// Lazy import để tránh crash khi bundle được tải sớm trên browser/CDN.
let _instPromise: Promise<any> | null = null;

async function loadSdk() {
  // Import động, chỉ khi cần
  const sdk = await import('@zama-fhe/relayer-sdk/bundle'); // { initSDK, createInstance, SepoliaConfig }
  await sdk.initSDK();
  return sdk;
}

export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = (async () => {
      const sdk = await loadSdk();
      return sdk.createInstance(sdk.SepoliaConfig);
    })();
  }
  return _instPromise;
}
