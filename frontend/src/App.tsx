// frontend/src/App.tsx
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  Interface,
  JsonRpcProvider,
} from "ethers";
import { AUCTIONS, AUCTION_META, CHAIN_ID, RPCS } from "./config";
import { encryptBidWithRetry, getFheInstance, waitForPublicKey, sleep } from "./lib/fhe";
import auctionArtifact from "./abi/FHEAuction.json";

/** ============ Ethers / ABI ============ */
const ABI = (auctionArtifact as any).abi;
const BYTECODE: string | undefined = (auctionArtifact as any)?.bytecode;

/** ============ Types ============ */
type Wallet = { address: string | null; chainId: number | null };
type AuctionStatus = { item: string; endTime: bigint; settled: boolean; winningBidEnc?: string; winningIndexEnc?: string };

const LS_KEY = "fhe_auctions";

/** ============ Utils ============ */
const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const nowSec = () => Math.floor(Date.now() / 1000);
const fmtTs = (ts?: bigint) => (ts ? new Date(Number(ts) * 1000).toLocaleString() : "-");

function initialAddrs(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    const env = (AUCTIONS || []).filter(isAddress);
    return Array.from(new Set([...(saved || []), ...env]));
  } catch {
    return (AUCTIONS || []).filter(isAddress);
  }
}
function saveAddrs(addrs: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(new Set(addrs))));
}

/** RPC-reads with fallbacks */
async function onAnyProvider<T>(fn: (p: JsonRpcProvider) => Promise<T>) {
  let lastErr: any;
  for (const url of RPCS) {
    try {
      const p = new JsonRpcProvider(url);
      return await fn(p);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all rpcs failed");
}

async function fetchStatus(addr: string): Promise<AuctionStatus | null> {
  try {
    return await onAnyProvider(async (provider) => {
      const c = new Contract(addr, ABI, provider);
      const [item, endTime, settled] = await c.getStatus();
      const st: AuctionStatus = { item, endTime, settled };
      if (settled) {
        st.winningBidEnc = await c.winningBidEnc();
        st.winningIndexEnc = await c.winningIndexEnc();
      }
      return st;
    });
  } catch {
    return null;
  }
}

/** ============ UI helpers ============ */
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, background: "#101826", color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 12, width: 340, zIndex: 50 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f2937", fontWeight: 600 }}>Thông báo</div>
      <div style={{ padding: 12, fontSize: 13, whiteSpace: "pre-wrap" }}>{text}</div>
      <div style={{ padding: 12, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>OK</button>
      </div>
    </div>
  );
}

/** ============ App ============ */
export default function App() {
  /** wallet */
  const [wallet, setWallet] = useState<Wallet>({ address: null, chainId: null });

  async function connect() {
    const anyWin = window as any;
    if (!anyWin.ethereum) return alert("Please install MetaMask.");

    // switch -> Sepolia
    const sepolia = "0xaa36a7";
    try {
      await anyWin.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: sepolia }] });
    } catch (err: any) {
      if (err?.code === 4902) {
        await anyWin.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: sepolia, chainName: "Sepolia", nativeCurrency: { name: "SepoliaETH", symbol: "SEP", decimals: 18 }, rpcUrls: RPCS, blockExplorerUrls: ["https://sepolia.etherscan.io"] }],
        });
        await anyWin.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: sepolia }] });
      } else {
        throw err;
      }
    }

    const provider = new BrowserProvider(anyWin.ethereum);
    await anyWin.ethereum.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });
  }

  /** list */
  const [addrList, setAddrList] = useState<string[]>(useMemo(initialAddrs, []));
  const [statusMap, setStatusMap] = useState<Record<string, AuctionStatus | null>>({});
  const [active, setActive] = useState<string>(addrList[0] || "");
  const [detail, setDetail] = useState<AuctionStatus | null>(null);

  useEffect(() => saveAddrs(addrList), [addrList]);

  // load list statuses
  useEffect(() => {
    if (!addrList.length) return;
    (async () => {
      const entries = await Promise.all(addrList.map((a) => fetchStatus(a)));
      const map: Record<string, AuctionStatus | null> = {};
      addrList.forEach((a, i) => (map[a] = entries[i]));
      setStatusMap(map);
    })();
  }, [addrList.join(",")]);

  // load active detail
  async function reloadActive(poll = false) {
    if (!active) return;
    if (!poll) {
      const st = await fetchStatus(active);
      setDetail(st);
      setStatusMap((m) => ({ ...m, [active]: st }));
      return;
    }
    // poll cho contract mới deploy (không cần ấn Refresh)
    for (let i = 0; i < 12; i++) {
      const st = await fetchStatus(active);
      if (st) {
        setDetail(st);
        setStatusMap((m) => ({ ...m, [active]: st }));
        return;
      }
      await sleep(1500);
    }
  }
  useEffect(() => { reloadActive(false); }, [active]);

  /** ui states */
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newMinutes, setNewMinutes] = useState(10);
  const [bid, setBid] = useState("");

  /** actions */
  async function createAuction() {
    try {
      if (!wallet.address) await connect();
      if (!newName.trim()) return setToast("Nhập tên item trước.");

      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const signer = await provider.getSigner();

      if (!BYTECODE) return setToast("Thiếu bytecode trong abi FHEAuction.json.");

      const factory = new ContractFactory(ABI, BYTECODE, signer);
      const c = await factory.deploy(newName.trim(), Math.max(60, newMinutes * 60));
      await c.waitForDeployment();
      // @ts-ignore
      const addr: string = c.target;

      // add vào list + set active và poll tới khi có getStatus
      const next = Array.from(new Set([addr, ...addrList]));
      setAddrList(next);
      setActive(addr);
      await reloadActive(true);

      setToast(`Deploy thành công: ${addr}`);
    } catch (e: any) {
      setToast("Deploy failed: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  async function submitBid(e: FormEvent) {
    e.preventDefault();
    try {
      if (!active) return;
      if (!wallet.address) await connect();
      if (!detail) return setToast("Active contract chưa sẵn sàng.");
      if (!/^\d+$/.test(bid)) return setToast("Bid phải là số nguyên không âm.");
      if (Number(detail.endTime) <= nowSec()) return setToast("Phiên đã kết thúc.");

      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();
      const me = await signer.getAddress();

      // FHE: đợi public key + mã hoá (có retry)
      setBusy("Preparing FHE key…");
      await waitForPublicKey(active, 120_000);

      setBusy("Encrypting…");
      const enc = await encryptBidWithRetry(active, me, BigInt(bid), 8);

      // gửi tx
      setBusy("Sending transaction…");
      const iface = new Interface(ABI);
      const data = iface.encodeFunctionData("bid", [enc.handles?.[0] ?? enc[0], enc.inputProof ?? enc.proof]);

      let gasLimit = 1_000_000n;
      try {
        const est = await signer.estimateGas({ to: active, data });
        if (est && est > 0n) gasLimit = est + est / 5n;
      } catch {}

      const tx = await signer.sendTransaction({ to: active, data, gasLimit });
      await tx.wait();

      setToast(`Đã gửi bid ${bid}.`);
      setBid("");
      await reloadActive(false);
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e);
      const hint = /kms|public key|input|proof|relayer|encrypt/i.test(msg)
        ? "\n(Mẹo: đợi 20–60s cho FHE key/proof sẵn sàng rồi thử lại.)"
        : "";
      setToast("Bid thất bại: " + msg + hint);
    } finally {
      setBusy(null);
    }
  }

  async function settle() {
    try {
      if (!active) return;
      if (!wallet.address) await connect();
      if (!detail) return;

      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const signer = await provider.getSigner();
      const c = new Contract(active, ABI, signer);

      const iface = new Interface(ABI);
      const fn = iface.getFunction("settle");
      const inputs = (fn as any).inputs ?? [];

      let tx;
      if (inputs.length === 0) tx = await c.settle();
      else if (inputs.length === 1 && inputs[0]?.type === "address[]") {
        const me = await signer.getAddress();
        tx = await c.settle([me]);
      } else {
        throw new Error("Unsupported settle() signature");
      }
      await tx.wait();
      setToast("Đã settle.");
      await reloadActive(false);
    } catch (e: any) {
      setToast("Settle thất bại: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  /** render */
  return (
    <div style={{ maxWidth: 1100, margin: "20px auto", padding: "0 12px", color: "#e5e7eb", fontFamily: "Inter, system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>⚡ FHE Auction</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Anonymous encrypted bidding on Sepolia</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input placeholder="Item name" value={newName} onChange={(e) => setNewName(e.target.value)}
                 style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb", width: 220 }} />
          <input type="number" min={1} value={newMinutes} onChange={(e) => setNewMinutes(Number(e.target.value))}
                 style={{ width: 72, padding: "6px 8px", borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }} />
          <button onClick={createAuction} style={{ padding: "6px 10px", borderRadius: 8, background: "#2563eb", color: "white" }}>
            + Create auction
          </button>

          <button onClick={connect} style={{ padding: "6px 10px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>
            {wallet.address ? "Reconnect" : "Connect Wallet"}
          </button>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {wallet.address ? `Connected ${wallet.address.slice(0, 6)}… (chain ${wallet.chainId})` : "Not connected"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
        {/* LEFT: list */}
        <section style={{ border: "1px solid #1f2937", borderRadius: 16, background: "#0b1220" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #1f2937" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Auctions</h3>
          </div>

          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {(addrList.length ? addrList : [""]).map((addr) => {
              const st = statusMap[addr];
              const meta = (AUCTION_META as any)?.[addr];
              const ended = st ? Number(st.endTime) <= nowSec() : false;
              return (
                <div key={addr} style={{ border: "1px solid #1f2937", borderRadius: 12, padding: 12, background: addr === active ? "#0e1627" : "#0b1220" }}>
                  <div style={{ fontWeight: 700 }}>{st ? (meta?.title || st.item) : "loading..."}</div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                    End: {st ? (ended ? "ended" : "ongoing") : "-"} · {st ? fmtTs(st.endTime) : "-"} · Settled: {st?.settled ? "true" : "false"}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={() => setActive(addr)} style={{ padding: "6px 10px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>Open</button>
                    <a href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#93c5fd" }}>
                      Etherscan
                    </a>
                    <code style={{ fontSize: 11, opacity: 0.7 }}>{addr.slice(0, 8)}…{addr.slice(-6)}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT: active */}
        {!!active && (
          <section style={{ border: "1px solid #1f2937", borderRadius: 16, background: "#0b1220" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Active auction</h3>
              <button onClick={() => reloadActive(false)} style={{ padding: "6px 10px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>
                Refresh status
              </button>
            </div>

            <div style={{ padding: 14, display: "grid", gap: 8 }}>
              <div><b>Item:</b> {detail?.item ?? "-"}</div>
              <div><b>End time:</b> {detail ? fmtTs(detail.endTime) : "-"} · {detail ? (Number(detail.endTime) > nowSec() ? "ongoing" : "ended") : "-"}</div>
              <div><b>Settled:</b> {detail?.settled ? "true" : "false"}</div>

              <form onSubmit={submitBid} style={{ display: "grid", gap: 10, maxWidth: 520, marginTop: 8 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  Your bid (uint32)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={bid}
                    onChange={(e) => setBid(e.target.value)}
                    disabled={!detail || Number(detail?.endTime || 0) <= nowSec() || !!busy}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }}
                  />
                </label>
                <button type="submit" disabled={!!busy || !detail || Number(detail?.endTime || 0) <= nowSec()}
                        style={{ padding: "10px 16px", borderRadius: 8, background: "#2563eb", color: "white" }}>
                  {busy ?? "Submit encrypted bid"}
                </button>
              </form>

              <div style={{ marginTop: 10 }}>
                <button onClick={settle} disabled={!detail || !(Number(detail?.endTime || 0) <= nowSec())}
                        style={{ padding: "8px 14px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>
                  Settle & reveal
                </button>
              </div>

              <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                Active contract: {active} · Chain: {CHAIN_ID}
              </p>
            </div>
          </section>
        )}
      </div>

      <Toast text={toast} onClose={() => setToast("")} />
    </div>
  );
}
