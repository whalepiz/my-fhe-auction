// src/lib/fhe.ts
// Dùng bundle + initSDK để load WASM trước khi createInstance (theo tài liệu SDK).
// Xem: docs Relayer SDK - Web apps & Initialization. 
import { initSDK, createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/bundle';

let _instPromise: Promise<any> | null = null;

export async function getFheInstance() {
  if (!_instPromise) {
    await initSDK(); // tải WASM cần thiết
    _instPromise = createInstance(SepoliaConfig);
  }
  return _instPromise;
}
