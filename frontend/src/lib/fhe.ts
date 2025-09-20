// frontend/src/lib/fhe.ts
import { CHAIN_ID } from "../config";

/**
 * Quan trọng:
 * Một số bundle trên trình duyệt thiếu "global" → polyfill để tránh black screen.
 */
// @ts-ignore
if (typeof (globalThis as any).global === "undefined") {
  // @ts-ignore
  (globalThis as any).global = globalThis;
}

let _instancePromise: Promise<any> | null = null;

/** Lazy create FHE instance chuẩn cho Sepolia */
export async function getFheInstance(): Promise<any> {
  if (_instancePromise) return _instancePromise;

  _instancePromise = (async () => {
    // import động để giảm lỗi type ở môi trường build
    const mod: any = await import("@fhevm/sdk");
    const createInstance: any = mod?.createInstance ?? mod?.default?.createInstance ?? mod?.default;

    // Tạo instance cho Sepolia. SDK tự biết KMS/Relayer của Sepolia.
    const inst = await createInstance({
      chainId: CHAIN_ID,
      network: "sepolia",
    });

    return inst;
  })();

  return _instancePromise;
}

/** Ngủ */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Đợi public key cho contract, có retry */
export async function waitForPublicKey(
  contractAddr: string,
  timeoutMs = 120_000
): Promise<void> {
  const inst = await getFheInstance();

  // Nếu SDK có sẵn waitForPublicKey thì dùng
  if (typeof inst?.waitForPublicKey === "function") {
    await inst.waitForPublicKey(contractAddr, { timeoutMs });
    return;
  }

  // Fallback poll getPublicKey
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (typeof inst?.getPublicKey === "function") {
        await inst.getPublicKey(contractAddr);
        return;
      }
      // nếu SDK quá cũ → thoát vòng cho có thông báo
      break;
    } catch {
      await sleep(1500);
    }
  }
  throw new Error("Public key not ready");
}

/** Mã hoá một giá bid uint32 kèm retry */
export async function encryptBidWithRetry(
  contractAddr: string,
  signerAddr: string,
  value: bigint,
  tries = 8
): Promise<any> {
  const inst = await getFheInstance();

  for (let i = 1; i <= tries; i++) {
    try {
      const buf = inst.createEncryptedInput(contractAddr, signerAddr);
      buf.add32(value);
      const enc = await buf.encrypt();
      return enc;
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      // lỗi KMS/relayer/public-key thường có ở lần đầu → retry luỹ tiến
      if (i === tries) throw new Error(msg || "encrypt failed");
      await sleep(800 * i);
    }
  }
  throw new Error("encrypt failed");
}
