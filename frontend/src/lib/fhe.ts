// frontend/src/lib/fhe.ts
import { createInstance, type FhevmInstance } from "@fhevm/sdk";
import { CHAIN_ID } from "../config";

// Chọn RPC có CORS (SDK sẽ fetch trực tiếp)
const NETWORK_URL = "https://ethereum-sepolia.publicnode.com";
// Gateway testnet của Zama
const GATEWAY_URL = "https://gateway.testnet.zama.ai";

let instance: FhevmInstance | null = null;

/** Lấy (hoặc khởi tạo) instance SDK FHEVM */
export async function getFheInstance(): Promise<FhevmInstance> {
  if (instance) return instance;

  instance = await createInstance({
    chainId: CHAIN_ID,
    networkUrl: NETWORK_URL,   // ✅ SDK mới dùng "networkUrl" (không còn rpcUrl)
    gatewayUrl: GATEWAY_URL,
  });

  return instance;
}
