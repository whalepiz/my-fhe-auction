// src/lib/fhe.ts
// Đúng theo docs: chỉ cần createInstance + SepoliaConfig
import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk';

let _instPromise: Promise<any> | null = null;

export async function getFheInstance() {
  if (!_instPromise) {
    _instPromise = createInstance(SepoliaConfig); // trả về Promise<FhevmInstance>
  }
  return _instPromise;
}
