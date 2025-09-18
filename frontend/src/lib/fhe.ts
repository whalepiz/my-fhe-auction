// src/lib/fhe.ts
// Dùng subpath /bundle để Vite resolve được; không gọi initSDK.
let _instPromise: Promise<any> | null = null;

export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = (async () => {
      // subpath import, tránh lỗi "Missing '.' specifier"
      const mod: any = await import('@zama-fhe/relayer-sdk/bundle');

      // fallback cho mọi kiểu export (named/default)
      const createInstance =
        mod?.createInstance || mod?.default?.createInstance;
      const SepoliaConfig =
        mod?.SepoliaConfig || mod?.default?.SepoliaConfig;

      if (!createInstance || !SepoliaConfig) {
        throw new Error(
          'relayer-sdk/bundle import mismatch (createInstance/SepoliaConfig not found)'
        );
      }
      return createInstance(SepoliaConfig);
    })();
  }
  return _instPromise;
}
