// src/lib/fhe.ts
// Dynamic import để tránh lỗi build/runtime trên Vercel.
// Không gọi initSDK; chỉ createInstance(SepoliaConfig).
let _instPromise: Promise<any> | null = null;

export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = (async () => {
      const mod: any = await import('@zama-fhe/relayer-sdk');
      // fallback cho mọi kiểu export có thể xảy ra
      const createInstance =
        mod?.createInstance || mod?.default?.createInstance;
      const SepoliaConfig =
        mod?.SepoliaConfig || mod?.default?.SepoliaConfig;

      if (!createInstance || !SepoliaConfig) {
        throw new Error('relayer-sdk import mismatch (createInstance/SepoliaConfig not found)');
      }
      return createInstance(SepoliaConfig);
    })();
  }
  return _instPromise;
}
