// src/lib/fhe.ts
// Nạp SDK từ CDN Zama (đã có wasm đúng MIME) theo kiểu dynamic import.

let cached: any = null;

export async function getFheInstance() {
  if (cached) return cached;

  // Dùng biến string (không để trực tiếp trong import) để tránh TS2307
  const ZAMA_CDN: string =
    "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.js";

  // @ts-ignore: để TS khỏi đòi type declarations cho URL ngoài
  const mod: any = await import(/* @vite-ignore */ ZAMA_CDN);

  const initSDK = mod?.initSDK ?? mod?.default?.initSDK;
  if (typeof initSDK === "function") {
    await initSDK();
  }

  const createInstance = mod?.createInstance ?? mod?.default?.createInstance;
  const SepoliaConfig = mod?.SepoliaConfig ?? mod?.default?.SepoliaConfig;

  if (!createInstance || !SepoliaConfig) {
    throw new Error("Relayer SDK missing createInstance/SepoliaConfig");
  }

  // Dùng provider của MetaMask
  const cfg = { ...SepoliaConfig, network: (window as any).ethereum };
  cached = await createInstance(cfg);
  return cached;
}
