// frontend/src/lib/fhe.ts
import { CHAIN_ID, RPCS } from "../config";

// Giữ 1 instance SDK trong suốt vòng đời trang
let _fheInstancePromise: Promise<any> | null = null;

// Một RPC ổn định cho SDK; khi fail, SDK tự lo phần fetch/proof qua relayer
function pickNetworkUrl(): string {
  return RPCS[0] || "https://ethereum-sepolia.publicnode.com";
}

export async function getFheInstance(): Promise<any> {
  if (_fheInstancePromise) return _fheInstancePromise;

  _fheInstancePromise = (async () => {
    const { createInstance } = await import("@fhevm/sdk");
    // API đúng của SDK bản mới: dùng networkUrl (không phải rpcUrl)
    const instance = await createInstance({
      networkUrl: pickNetworkUrl(),
      chainId: CHAIN_ID,
    });
    return instance;
  })();

  return _fheInstancePromise;
}

// Chờ public key có sẵn (nếu SDK hỗ trợ), fallback getPublicKey
export async function waitPublicKey(contractAddr: string, setBusy?: (s: string | null) => void) {
  try {
    const inst = await getFheInstance();
    if (typeof inst.waitForPublicKey === "function") {
      setBusy?.("Preparing FHE key…");
      await inst.waitForPublicKey(contractAddr, { timeoutMs: 120_000 });
      return;
    }
    // Fallback loop
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

export function decodeRevert(abi: any[], err: any): string | null {
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
