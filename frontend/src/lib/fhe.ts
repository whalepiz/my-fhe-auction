// frontend/src/lib/fhe.ts
import { createInstance } from "@fhevm/sdk";

let _inst: Promise<any> | null = null;

/**
 * Khởi tạo 1 lần cho toàn app (Sepolia + gateway/relayer testnet).
 */
export function getFheInstance() {
  if (!_inst) {
    _inst = createInstance({
      chainId: 11155111, // Sepolia
      rpcUrl: "https://rpc.sepolia.org",
      gatewayUrl: "https://gateway.testnet.zama.ai",
      relayerUrl: "https://relayer.testnet.zama.ai",
    });
  }
  return _inst;
}
