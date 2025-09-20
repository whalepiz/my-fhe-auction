// frontend/src/lib/fhe.ts
import { CHAIN_ID } from "../config";

// Tất cả dựa trên @fhevm/sdk (không dùng @zama-fhe/relayer-sdk)
let _instance: any | null = null;

export async function getFheInstance() {
  if (_instance) return _instance;

  // import động để tránh lỗi types khi build
  const { createInstance } = await import("@fhevm/sdk");

  // SDK mới chỉ cần 'network' và 'chainId'. Sepolia = 'sepolia'
  _instance = await createInstance({
    chainId: CHAIN_ID,
    network: "sepolia",
  });

  return _instance;
}

/**
 * Chờ public key của contract sẵn sàng.
 * SDK >= 0.9 có waitForPublicKey; nếu không có thì fallback getPublicKey.
 */
export async function waitForPublicKey(
  contractAddr: string,
  timeoutMs = 60_000
) {
  const inst = await getFheInstance();
  if (typeof inst.waitForPublicKey === "function") {
    await inst.waitForPublicKey(contractAddr, { timeoutMs });
  } else if (typeof inst.getPublicKey === "function") {
    await inst.getPublicKey(contractAddr);
  }
}

/**
 * Mã hoá số uint32 + tạo bằng chứng input (proof) qua SDK.
 * Trả về { handles, inputProof } giống định dạng bạn đang encode vào calldata.
 */
export async function encryptUint32WithProof(
  contractAddr: string,
  userAddr: string,
  value: bigint
): Promise<{ handles: string[]; inputProof: string }> {
  const inst = await getFheInstance();

  // builder theo SDK: add32(...) rồi encrypt()
  const builder = inst.createEncryptedInput(contractAddr, userAddr);
  builder.add32(value);

  // encrypt() trả về { handles, inputProof }
  const enc = await builder.encrypt();
  return enc;
}
