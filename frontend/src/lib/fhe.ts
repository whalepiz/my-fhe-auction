/* frontend/src/lib/fhe.ts */
import { JsonRpcProvider } from "ethers";
import { CHAIN_ID, RELAYER_URL, RPCS } from "../config";
// @ts-ignore ESM types
import { createInstance } from "@fhevm/sdk";
import Relayer from "@zama-fhe/relayer-sdk";

let _fhe: any | null = null;
let _relayer: any | null = null;

function pickRpc(): string {
  return RPCS[Math.floor(Math.random() * RPCS.length)];
}

function makeReadProvider(): JsonRpcProvider {
  return new JsonRpcProvider(pickRpc());
}

/** Lấy/cấp phát FHE instance — KHÔNG cần KMS thủ công */
export async function getFheInstance() {
  if (_fhe) return _fhe;

  _fhe = await createInstance({
    chainId: CHAIN_ID,
    provider: makeReadProvider(),
  });

  return _fhe;
}

/** Relayer client (xin input-proof) */
export async function getRelayer() {
  if (_relayer) return _relayer;
  _relayer = new Relayer({
    relayerUrl: RELAYER_URL,
    chainId: CHAIN_ID,
  });
  return _relayer;
}

/** Đợi public key cho contract (SDK mới có waitForPublicKey; cũ thì fallback getPublicKey) */
export async function waitForPublicKey(contractAddr: string) {
  const fhe = await getFheInstance();
  if (typeof fhe.waitForPublicKey === "function") {
    await fhe.waitForPublicKey(contractAddr, { timeout: 120000 });
    return;
  }
  // Fallback
  for (let i = 0; i < 8; i++) {
    try {
      await fhe.getPublicKey(contractAddr);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

/** Mã hoá uint32 + xin input-proof từ relayer (có retry nhẹ) */
export async function encryptUint32WithProof(
  contractAddr: string,
  signerAddr: string,
  value: bigint
): Promise<{ handles: string[]; inputProof: string }> {
  const fhe = await getFheInstance();
  const relayer = await getRelayer();

  // đảm bảo key sẵn
  await waitForPublicKey(contractAddr);

  let lastErr: any = null;
  for (let i = 0; i < 5; i++) {
    try {
      const enc = fhe.createEncryptedInput(contractAddr, signerAddr);
      enc.add32(value);
      const input = await enc.encrypt();

      const proof = await relayer.getInputProof(input);
      return { handles: input.handles, inputProof: proof };
    } catch (e: any) {
      lastErr = e;
      const m = String(e?.message || "");
      const retriable = /timeout|fetch|500|gateway|public key|network/i.test(m);
      if (!retriable) break;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr ?? new Error("encryptUint32WithProof failed");
}
