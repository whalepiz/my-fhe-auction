// frontend/src/lib/fhe.ts
import { CHAIN_ID, RPCS } from "../config";

let _fheInstancePromise: Promise<any> | null = null;

function pickRpc(): string {
  return RPCS[0] || "https://ethereum-sepolia.publicnode.com";
}

export async function getFheInstance(): Promise<any> {
  if (_fheInstancePromise) return _fheInstancePromise;

  _fheInstancePromise = (async () => {
    const { createInstance } = await import("@fhevm/sdk");

    // Một số version SDK nhận "network", số khác nhận "rpcUrl"
    // Ta truyền cả 2, TypeScript không kêu nữa nhờ ép kiểu any
    const cfg: any = {
      chainId: CHAIN_ID,
      network: pickRpc(),
      rpcUrl: pickRpc(),
    };

    const instance = await createInstance(cfg);
    return instance;
  })();

  return _fheInstancePromise;
}

export async function waitPublicKey(contractAddr: string, setBusy?: (s: string | null) => void) {
  try {
    const inst = await getFheInstance();
    if (typeof inst.waitForPublicKey === "function") {
      setBusy?.("Preparing FHE key…");
      await inst.waitForPublicKey(contractAddr, { timeoutMs: 120_000 });
      return;
    }
    for (let i = 1; i <= 8; i++) {
      try {
        setBusy?.(`Fetching FHE key… (try ${i}/8)`);
        if (typeof inst.getPublicKey === "function") {
          await inst.getPublicKey(contractAddr);
          return;
        }
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  } finally {
    setBusy?.(null);
  }
}

export async function encryptBidWithRetry(
  contractAddr: string,
  signerAddr: string,
  value: bigint,
  setBusy?: (s: string | null) => void
): Promise<{ handles: string[]; inputProof: string }> {
  const inst = await getFheInstance();
  for (let i = 1; i <= 10; i++) {
    try {
      setBusy?.(`Encrypting (try ${i}/10)…`);
      const buf = inst.createEncryptedInput(contractAddr, signerAddr);
      buf.add32(value);
      const enc = await buf.encrypt();
      return enc;
    } catch (err: any) {
      const msg = String(err?.message || "");
      const retry = /REQUEST FAILED|500|public key|gateway|relayer|fetch|timeout/i.test(msg);
      if (!retry || i === 10) throw err;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
  throw new Error("Encryption kept failing.");
}

export async function decodeRevert(abi: any[], err: any): Promise<string | null> {
  try {
    const data =
      err?.data?.data ||
      err?.error?.data ||
      err?.error?.error?.data ||
      err?.info?.error?.data ||
      err?.data ||
      err?.receipt?.revertReason ||
      null;
    if (!data) return null;
    const { Interface } = await import("ethers");
    const iface = new Interface(abi);
    const parsed = iface.parseError(data);
    if (!parsed) return null;
    const args = parsed?.args ? JSON.stringify(parsed.args) : "";
    return `${parsed.name}${args ? " " + args : ""}`;
  } catch {
    return null;
  }
}
