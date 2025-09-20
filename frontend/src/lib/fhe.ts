// frontend/src/lib/fhe.ts
import { createInstance } from "@fhevm/sdk"; // SDK web chính thức

let _inst: Promise<any> | null = null;

/**
 * Khởi tạo 1 lần cho cả app.
 * - Gateway/Relayer chuẩn testnet Zama
 * - Chain Sepolia
 */
export function getFheInstance() {
  if (!_inst) {
    _inst = createInstance({
      chainId: 11155111,
      rpcUrl: "https://rpc.sepolia.org",
      gatewayUrl: "https://gateway.testnet.zama.ai",
      relayerUrl: "https://relayer.testnet.zama.ai",
    });
  }
  return _inst;
}
