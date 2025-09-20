// frontend/src/lib/fhe.ts
import { createInstance, type FhevmInstance } from "@fhevm/sdk";
import { CHAIN_ID } from "../config";

// RPC công khai cho Sepolia (CORS OK)
const RPC = "https://ethereum-sepolia.publicnode.com";
// Gateway testnet của Zama
const GATEWAY = "https://gateway.testnet.zama.ai";

let instance: FhevmInstance | null = null;

/**
 * Trả về 1 instance FHEVM SDK đã khởi tạo.
 * Dùng ép kiểu "any" để tương thích cả SDK đời cũ (rpcUrl) và đời mới (networkUrl).
 */
export async function getFheInstance(): Promise<FhevmInstance> {
  if (instance) return instance;

  // ép kiểu để TS không than phiền về 'rpcUrl' / 'networkUrl'
  const cfg: any = {
    chainId: CHAIN_ID,
    gatewayUrl: GATEWAY,
    networkUrl: RPC, // SDK mới
    rpcUrl: RPC,     // SDK cũ
  };

  instance = (await createInstance(cfg as any)) as FhevmInstance;
  return instance;
}
