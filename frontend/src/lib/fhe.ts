// src/lib/fhe.ts
// Import động từ /bundle để Vite resolve được.
// Gọi initSDK nếu SDK có export, rồi tạo instance.

let _instPromise: Promise<any> | null = null;

export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = (async () => {
      const mod: any = await import('@zama-fhe/relayer-sdk/bundle');

      const initSDK =
        mod?.initSDK || mod?.default?.initSDK || null;
      const createInstance =
        mod?.createInstance || mod?.default?.createInstance;
      const SepoliaConfig =
        mod?.SepoliaConfig || mod?.default?.SepoliaConfig;

      if (!createInstance || !SepoliaConfig) {
        throw new Error(
          'relayer-sdk/bundle import mismatch (createInstance/SepoliaConfig not found)'
        );
      }

      // Một số phiên bản bundle yêu cầu initSDK trước khi dùng
      if (typeof initSDK === 'function') {
        await initSDK();
      }

      return createInstance(SepoliaConfig);
    })();
  }
  return _instPromise;
}
