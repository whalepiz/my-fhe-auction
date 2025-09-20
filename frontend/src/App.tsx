import React, { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  Fragment,
  Interface,
  JsonRpcProvider,
} from "ethers";
import { getFheInstance } from "./lib/fhe";
import auctionAbiJson from "./abi/FHEAuction.json";
import { CHAIN_ID, AUCTIONS as ENV_AUCTIONS, AUCTION_META } from "./config";

/** ---------- ABI / Bytecode ---------- */
const auctionAbi = (auctionAbiJson as any).abi;
const auctionBytecode: string | undefined = (auctionAbiJson as any)?.bytecode;

/** ---------- Types ---------- */
type Wallet = { address: string | null; chainId: number | null };

type AuctionStatus = {
  item: string;
  endTime: bigint;
  settled: boolean;
  winningBidEnc?: string;
  winningIndexEnc?: string;
};

/** ---------- Utils ---------- */
const RPCS = [
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
  "https://ethereum-sepolia.publicnode.com",
  "https://rpc2.sepolia.org",
];

const LS_KEY = "fhe_auctions";

function fmtTs(ts?: bigint) {
  if (!ts) return "-";
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}
function nowSec() { return Math.floor(Date.now() / 1000); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function isAddress(s: string) { return /^0x[a-fA-F0-9]{40}$/.test(s); }
function fmtRemain(s: number) {
  if (s <= 0) return "0s";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** ---------- Persist local auction list ---------- */
function loadLocalAddrs(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: any) => typeof x === "string" && isAddress(x));
  } catch {
    return [];
  }
}
function saveLocalAddrs(addrs: string[]) {
  const uniq = Array.from(new Set(addrs.filter(isAddress)));
  localStorage.setItem(LS_KEY, JSON.stringify(uniq));
}
function initialAddrList(): string[] {
  const env = (ENV_AUCTIONS || []).filter(isAddress);
  const ls = loadLocalAddrs();
  return Array.from(new Set([...env, ...ls]));
}

/** ---------- Provider helpers ---------- */
async function tryProviders<T>(
  call: (p: BrowserProvider | JsonRpcProvider) => Promise<T>
): Promise<T> {
  let lastErr: any;
  for (const url of RPCS) {
    const p = new JsonRpcProvider(url);
    try {
      return await call(p);
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr ?? new Error("All providers failed");
}

async function safeReadStatus(addr: string): Promise<AuctionStatus | null> {
  try {
    return await tryProviders(async (provider) => {
      const c = new Contract(addr, auctionAbi, provider);
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

/** ---------- FHE helpers ---------- */
async function waitPublicKey(contractAddr: string, setBusy?: (s: string | null) => void) {
  try {
    const inst = await getFheInstance();
    if ((inst as any)?.waitForPublicKey) {
      setBusy?.("Preparing FHE key…");
      await (inst as any).waitForPublicKey(contractAddr, { timeoutMs: 120000 });
      return;
    }
    // fallback loop
    for (let i = 1; i <= 8; i++) {
      try {
        setBusy?.(`Fetching FHE key… (try ${i}/8)`);
        if ((inst as any)?.getPublicKey) {
          await (inst as any).getPublicKey(contractAddr);
          return;
        }
        break;
      } catch {
        await sleep(1500 * i);
      }
    }
  } finally {
    setBusy?.(null);
  }
}

async function encryptBidWithRetry(
  contractAddr: string,
  signerAddr: string,
  value: bigint,
  setBusy?: (s: string | null) => void
) {
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
      const retriable = /REQUEST FAILED|500|public key|gateway|relayer|fetch|timeout/i.test(msg);
      if (!retriable || i === 10) throw err;
      await sleep(800 * i);
    }
  }
  throw new Error("FHE key not ready.");
}

/** Decode revert reason if possible */
function decodeRevert(err: any): string | null {
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
    const iface = new Interface(auctionAbi);
    const parsed = iface.parseError(data);
    if (!parsed) return null;
    const args = parsed?.args ? JSON.stringify(parsed.args) : "";
    return `${parsed.name}${args ? " " + args : ""}`;
  } catch {
    return null;
  }
}

/** ---------- NEW: Preflight on-chain (eth_call) ---------- */
async function preflightOnchain(
  signer: any,
  contractAddr: string,
  calldata: string,
  setBusy?: (s: string | null) => void
) {
  for (let i = 1; i <= 20; i++) {
    try {
      setBusy?.(`Preflight… (try ${i}/20)`);
      // Nếu không throw → OK để gửi thật
      await signer.call({ to: contractAddr, data: calldata });
      return;
    } catch (e: any) {
      // nếu revert → thường proof chưa đồng bộ, đợi rồi thử lại
      await sleep(1000 + i * 250);
    }
  }
  throw new Error("Preflight failed: execution reverted (unknown custom error)");
}

/** ---------- UI bits ---------- */
function Badge({ color, children }: { color: "green" | "gray" | "orange" | "blue"; children: React.ReactNode }) {
  const bg =
    color === "green" ? "#103e2a" :
    color === "orange" ? "#3f2b00" :
    color === "blue" ? "#0b274d" : "#2a2d35";
  const tx =
    color === "green" ? "#50e3a4" :
    color === "orange" ? "#ffca70" :
    color === "blue" ? "#75a7ff" : "#cbd5e1";
  return <span style={{ background: bg, color: tx, padding: "2px 8px", borderRadius: 999, fontSize: 12 }}>{children}</span>;
}
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, background: "#101826", color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 12, width: 300, zIndex: 9999 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f2937", fontWeight: 600 }}>Thông báo</div>
      <div style={{ padding: 12, fontSize: 13, whiteSpace: "pre-wrap" }}>{text}</div>
      <div style={{ padding: 12, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>OK</button>
      </div>
    </div>
  );
}

/** ===================================================
 *                     APP
 * =================================================== */
export default function App() {
  /** Wallet */
  const [wallet, setWallet] = useState<Wallet>({ address: null, chainId: null });

  async function connect() {
    const anyWin = window as any;
    if (!anyWin.ethereum) return alert("MetaMask not found");

    const sepoliaHex = "0xaa36a7"; // 11155111
    try {
      await anyWin.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: sepoliaHex }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await anyWin.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: sepoliaHex,
              chainName: "Sepolia",
              nativeCurrency: { name: "SepoliaETH", symbol: "SEP", decimals: 18 },
              rpcUrls: RPCS,
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
        await anyWin.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: sepoliaHex }],
        });
      } else {
        alert(`Please switch MetaMask to Sepolia (chainId ${CHAIN_ID}).`);
        return;
      }
    }

    const provider = new BrowserProvider(anyWin.ethereum);
    await anyWin.ethereum.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });
  }

  /** Auction list (persist) */
  const initialAddresses = useMemo(initialAddrList, []);
  const [addrList, setAddrList] = useState<string[]>(initialAddresses);
  const [active, setActive] = useState<string>(initialAddresses[0] ?? "");
  const [listStatus, setListStatus] = useState<Record<string, AuctionStatus | null>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => { saveLocalAddrs(addrList); }, [addrList]);

  useEffect(() => {
    (async () => {
      if (!addrList.length) return;
      setLoadingList(true);
      try {
        const results = await Promise.allSettled(addrList.map((addr) => safeReadStatus(addr)));
        const map: Record<string, AuctionStatus | null> = {};
        results.forEach((res, i) => {
          const addr = addrList[i];
          map[addr] = res.status === "fulfilled" ? res.value : null;
        });
        setListStatus(map);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [addrList.join(",")]);

  /** Active detail */
  const [detail, setDetail] = useState<AuctionStatus | null>(null);
  const [bid, setBid] = useState("");
  const [busy, setBusy] = useState<null | string>(null);

  async function refreshDetail() {
    if (!active) return;
    const st = await safeReadStatus(active);
    setDetail(st);
    setListStatus((old) => ({ ...old, [active]: st }));
  }
  useEffect(() => { refreshDetail(); }, [active]);

  /** Actions */
  async function submitBid(ev: FormEvent) {
    ev.preventDefault();
    if (!wallet.address) return setToast("Hãy kết nối ví trước.");
    if (!detail) return setToast("Địa chỉ không tương thích FHEAuction.");
    if (!/^\d+$/.test(bid)) return setToast("Bid phải là số nguyên không âm.");
    if (Number(detail?.endTime || 0) <= nowSec()) return setToast("Phiên đã kết thúc.");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    try {
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();
      const me = await signer.getAddress();

      // 1) FHE public key
      await waitPublicKey(active, setBusy);

      // 2) Encrypt + retry
      const enc = await encryptBidWithRetry(active, me, BigInt(bid), setBusy);

      // 3) Encode calldata
      const iface = new Interface(auctionAbi);
      const data = iface.encodeFunctionData("bid", [enc.handles[0], enc.inputProof]);

      // 4) NEW: preflight on-chain until pass, rồi mới mở MetaMask
      await preflightOnchain(signer, active, data, setBusy);

      // 5) Ước lượng gas và gửi thật
      setBusy("Sending transaction…");
      let gasLimit = 1_200_000n;
      try {
        const est = await signer.estimateGas({ to: active, data });
        if (est && est > 0n) gasLimit = est + (est / 5n);
      } catch {}
      const tx = await signer.sendTransaction({ to: active, data, gasLimit });
      await tx.wait();

      setToast(`Đã gửi bid (encrypted) = ${bid}`);
      setBid("");
      await refreshDetail();
    } catch (err: any) {
      const decoded = decodeRevert(err);
      const base =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      const reason = decoded ? ` | Revert: ${decoded}` : "";
      const txHash =
        err?.transactionHash ||
        err?.receipt?.transactionHash ||
        err?.hash || "";
      const link = txHash ? `\nTx: https://sepolia.etherscan.io/tx/${txHash}` : "";
      setToast("Bid thất bại: " + base + reason + link);
    } finally {
      setBusy(null);
    }
  }

  async function settleAndReveal() {
    if (!active) return;
    if (!detail) return setToast("Địa chỉ không tương thích.");
    if (Number(detail?.endTime || 0) > nowSec()) return setToast("Chưa hết hạn.");

    try {
      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const signer = await provider.getSigner();
      const c = new Contract(active, auctionAbi, signer);

      const iface = new Interface(auctionAbi);
      let frag: Fragment | null = null;
      try { frag = iface.getFunction("settle"); } catch {}
      if (!frag) throw new Error("Contract không có settle()");

      const inputs = (frag as any).inputs ?? [];
      let tx;
      if (inputs.length === 0) tx = await c.settle();
      else if (inputs.length === 1 && inputs[0].type === "address[]") {
        const me = await signer.getAddress();
        tx = await c.settle([me]);
      } else {
        throw new Error(`Unsupported settle signature: ${(frag as any).format("full")}`);
      }
      await tx.wait();
      setToast("Đã settle. Ciphertexts đã hiển thị.");
      await refreshDetail();
    } catch (err: any) {
      const msg = err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Settle thất bại: " + msg);
    }
  }

  async function createAuction(name: string, minutes: number) {
    if (!wallet.address) return setToast("Kết nối ví trước.");
    const secs = Math.max(60, Math.floor(Number(minutes) * 60));

    try {
      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();

      if (!auctionBytecode) {
        return setToast(
          "Thiếu bytecode trong FHEAuction.json. Hãy dùng artifact Hardhat (có bytecode)."
        );
      }

      const factory = new ContractFactory(auctionAbi, auctionBytecode, signer);
      const c = await factory.deploy(name.trim(), secs);
      await c.waitForDeployment();
      // @ts-ignore v6
      const newAddr: string = c.target;

      setToast(`Deploy thành công: ${newAddr}`);
      const next = Array.from(new Set([newAddr, ...addrList]));
      setAddrList(next);
      setActive(newAddr);
      await refreshDetail();
    } catch (err: any) {
      const msg = err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Deploy thất bại: " + msg);
    }
  }

  /** ---------- Simple quick create UI (header button) ---------- */
  const [creating, setCreating] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [newMinutes, setNewMinutes] = useState(10);

  /** ---------- Render ---------- */
  const ended = detail ? Number(detail.endTime) <= nowSec() : false;

  return (
    <div style={{ maxWidth: 1060, margin: "20px auto", padding: "0 12px", color: "#e5e7eb", fontFamily: "Inter, system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>⚡ FHE Auction</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Anonymous encrypted bidding on Sepolia</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              placeholder="Item name"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }}
            />
            <input
              type="number"
              min={1}
              value={newMinutes}
              onChange={(e) => setNewMinutes(Number(e.target.value))}
              style={{ width: 90, padding: "6px 8px", borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }}
            />
            <button
              onClick={async () => {
                if (!newItem.trim()) return setToast("Nhập tên item.");
                setCreating(true);
                try { await createAuction(newItem, newMinutes); }
                finally { setCreating(false); }
              }}
              disabled={creating}
              style={{ padding: "6px 10px", borderRadius: 8, background: "#2563eb", color: "white" }}
            >
              {creating ? "Deploying…" : "+ Create auction"}
            </button>
          </div>
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
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Auctions</h3>
            {loadingList && <span style={{ fontSize: 12, opacity: 0.7 }}>Loading…</span>}
          </div>

          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {(addrList.length ? addrList : [""]).map((addr) => {
              const st = listStatus[addr];
              const incompatible = st === null;
              const meta = (AUCTION_META as any)?.[addr];
              const isActive = addr === active;
              const endedCard = st ? Number(st.endTime) <= nowSec() : false;

              return (
                <div
                  key={addr}
                  style={{
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    padding: 12,
                    background: isActive ? "#0e1627" : "#0b1220",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontWeight: 700 }}>
                      {st === undefined ? "loading…" : incompatible ? "(incompatible)" : meta?.title || st?.item || "(unknown)"}
                    </div>
                    {st && (
                      <div>
                        {!st.settled && !endedCard && <Badge color="green">Ongoing</Badge>}
                        {!st.settled && endedCard && <Badge color="orange">Ended</Badge>}
                        {st.settled && <Badge color="blue">Settled</Badge>}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    End: {incompatible ? "-" : st ? (Number(st.endTime) > nowSec() ? "ongoing" : "ended") : "-"} · {st ? fmtTs(st.endTime) : "-"}
                    {st && Number(st.endTime) > nowSec() && <> · <b>{fmtRemain(Number(st.endTime) - nowSec())}</b></>}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Settled: {incompatible ? "-" : st?.settled ? "true" : "false"}</div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <button onClick={() => setActive(addr)} disabled={incompatible} style={{ padding: "6px 10px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>
                      Open
                    </button>
                    <a href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#93c5fd" }}>
                      Etherscan
                    </a>
                    <code
                      title="Copy"
                      onClick={() => navigator.clipboard?.writeText(addr).then(() => setToast("Đã copy địa chỉ hợp đồng."))}
                      style={{ fontSize: 11, opacity: 0.7, cursor: "pointer" }}
                    >
                      {addr.slice(0, 8)}…{addr.slice(-6)}
                    </code>
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
              <button onClick={refreshDetail} style={{ padding: "6px 10px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>Refresh status</button>
            </div>

            <div style={{ padding: 14, display: "grid", gap: 8 }}>
              <div><b>Item:</b> {detail?.item ?? "-"}</div>
              <div>
                <b>End time:</b> {detail ? fmtTs(detail.endTime) : "-"} ·{" "}
                {detail ? (Number(detail.endTime) > nowSec()
                  ? <>ongoing · <b>{fmtRemain(Number(detail.endTime) - nowSec())}</b></>
                  : "ended") : "-"}
              </div>
              <div><b>Settled:</b> {detail?.settled ? "true" : "false"}</div>
              {detail?.settled && (
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  <div>winningBidEnc: <code>{detail.winningBidEnc}</code></div>
                  <div>winningIndexEnc: <code>{detail.winningIndexEnc}</code></div>
                </div>
              )}

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
                <button
                  type="submit"
                  disabled={!!busy || !detail || Number(detail?.endTime || 0) <= nowSec()}
                  style={{ padding: "10px 16px", borderRadius: 8, background: "#2563eb", color: "white" }}
                >
                  {busy ? busy : "Submit encrypted bid"}
                </button>
              </form>

              <div style={{ marginTop: 10 }}>
                <button
                  onClick={settleAndReveal}
                  disabled={!detail || !(Number(detail?.endTime || 0) <= nowSec())}
                  style={{ padding: "8px 14px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}
                >
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

