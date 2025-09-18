// src/lib/fhe.ts
// Import tĩnh từ root package + chỉ init khi được gọi.
import { initSDK, createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk';

let _instPromise: Promise<any> | null = null;
let _sdkInited = false;

/** Khởi tạo instance Relayer SDK cho Sepolia (chỉ 1 lần) */
export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = (async () => {
      if (!_sdkInited) {
        await initSDK();      // tải WASM và init SDK
        _sdkInited = true;
      }
      return createInstance(SepoliaConfig);
    })();
  }
  return _instPromise;
}
