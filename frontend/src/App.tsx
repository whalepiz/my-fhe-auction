// frontend/src/App.tsx
import { type FormEvent, useEffect, useMemo, useState } from "react";
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
import { CHAIN_ID, AUCTIONS as ENV_AUCTIONS } from "./config";

const auctionAbi = (auctionAbiJson as any).abi;
const auctionBytecode: string | undefined = (auctionAbiJson as any)?.bytecode;

type Wallet = { address: string | null; chainId: number | null };

type AuctionStatus = {
  item: string;
  endTime: bigint;
  settled: boolean;
  winningBidEnc?: string;
  winningIndexEnc?: string;
};

const RPCS = [
  "https://ethereum-sepolia.publicnode.com",
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
];

const LS_KEY = "fhe_auctions";

function fmtTs(ts?: bigint) {
  if (!ts) return "-";
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
function fmtRemain(s: number) {
  if (s <= 0) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

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

async function tryProviders<T>(
  call: (p: BrowserProvider | JsonRpcProvider) => Promise<T>
): Promise<T> {
  let lastErr: any;
  for (const url of RPCS) {
    const p = new JsonRpcProvider(url);
    try {
      return await call(p);
    } catch (e) {
      lastErr = e;
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

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, background: "#101826", color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 12, width: 320, zIndex: 9999 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f2937", fontWeight: 600 }}>Thông báo</div>
      <div style={{ padding: 12, fontSize: 13, whiteSpace: "pre-wrap" }}>{text}</div>
      <div style={{ padding: 12, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 8, background: "#111827", color: "#e5e7eb" }}>OK</button>
      </div>
    </div>
  );
}

export default function App() {
  const [wallet, setWallet] = useState<Wallet>({ address: null, chainId: null });
  const [toast, setToast] = useState("");

  async function connect() {
    const anyWin = window as any;
    if (!anyWin.ethereum) return setToast("Không tìm thấy MetaMask.");

    const sepoliaHex = "0xaa36a7";
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
      } else {
        return setToast("Hãy chuyển MetaMask sang Sepolia.");
      }
    }

    const provider = new BrowserProvider(anyWin.ethereum);
    await anyWin.ethereum.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });
  }

  const initialAddresses = useMemo(initialAddrList, []);
  const [addrList, setAddrList] = useState<string[]>(initialAddresses);
  const [active, setActive] = useState<string>(initialAddresses[0] ?? "");
  const [listStatus, setListStatus] = useState<Record<string, AuctionStatus | null>>({});
  const [loadingList, setLoadingList] = useState(false);

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
      } finally { setLoadingList(false); }
    })();
  }, [addrList.join(",")]);

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

  // làm ấm public key (không chặn UI)
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!active) return;
      try {
        const inst = await getFheInstance();
        // nếu SDK có API waitForPublicKey thì gọi, nếu không thì getPublicKey
        // @ts-ignore
        if (inst.waitForPublicKey) await inst.waitForPublicKey(active, { timeoutMs: 1 });
        // @ts-ignore
        else if (inst.getPublicKey) await inst.getPublicKey(active);
      } catch {}
      if (stop) return;
    })();
    return () => { stop = true; };
  }, [active]);

  async function submitBid(ev: FormEvent) {
    ev.preventDefault();
    if (!wallet.address) return setToast("Hãy kết nối ví trước.");
    if (!detail) return setToast("Địa chỉ không tương thích FHEAuction.");
    if (!/^\d+$/.test(bid)) return setToast("Bid phải là số nguyên không âm.");
    if (Number(detail.endTime) <= nowSec()) return setToast("Phiên đã kết thúc.");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    try {
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();
      const me = await signer.getAddress();

      setBusy("Encrypting…");
      const inst = await getFheInstance();
      const buf = inst.createEncryptedInput(active, me);
      buf.add32(BigInt(bid));
      const enc = await buf.encrypt(); // SDK sẽ gọi Gateway

      // Gửi thẳng (không preflight, đặt gasLimit thủ công để ethers không estimate)
      setBusy("Sending transaction…");
      const iface = new Interface(auctionAbi);
      const data = iface.encodeFunctionData("bid", [enc.handles[0], enc.inputProof]);

      const tx = await signer.sendTransaction({
        to: active,
        data,
        gasLimit: 1_200_000n, // dư dả, tránh estimateGas
      });

      await tx.wait();
      setToast(`Đã gửi bid (encrypted) = ${bid}`);
      setBid("");
      await refreshDetail();
    } catch (err: any) {
      const base =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Bid thất bại: " + base);
    } finally {
      setBusy(null);
    }
  }

  async function settleAndReveal() {
    if (!active) return;
    if (!detail) return setToast("Địa chỉ không tương thích.");
    if (Number(detail.endTime) > nowSec()) return setToast("Chưa hết hạn.");

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

  const [newItem, setNewItem] = useState("Test");
  const [newMinutes, setNewMinutes] = useState(10);
  const [creating, setCreating] = useState(false);

  async function createAuction() {
    if (!wallet.address) return setToast("Kết nối ví trước.");
    const secs = Math.max(60, Math.floor(Number(newMinutes) * 60));
    try {
      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();

      if (!auctionBytecode) return setToast("Thiếu bytecode trong FHEAuction.json.");

      const factory = new ContractFactory(auctionAbi, auctionBytecode, signer);
      const c = await factory.deploy(newItem.trim(), secs);
      await c.waitForDeployment();
      // @ts-ignore ethers v6
      const addr: string = c.target;

      setToast(`Deploy thành công: ${addr}`);
      const next = Array.from(new Set([addr, ...addrList]));
      setAddrList(next);
      setActive(addr);
      await refreshDetail();
    } catch (err: any) {
      const msg = err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Deploy thất bại: " + msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 1060, margin: "20px auto", padding: "0 12px", color: "#e5e7eb", fontFamily: "Inter, system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>⚡ FHE Auction</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Anonymous encrypted bidding on Sepolia</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            onClick={() => { setCreating(true); createAuction(); }}
            disabled={creating}
            style={{ padding: "6px 10px", borderRadius: 8, background: "#2563eb", color: "white" }}
          >
            {creating ? "Deploying…" : "+ Create auction"}
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
        <section style={{ border: "1px solid #1f2937", borderRadius: 16, background: "#0b1220" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Auctions</h3>
            {loadingList && <span style={{ fontSize: 12, opacity: 0.7 }}>Loading…</span>}
          </div>

          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {(addrList.length ? addrList : [""]).map((addr) => {
              const st = listStatus[addr];
              const incompatible = st === null;
              const isActive = addr === active;
              const ended = st ? Number(st.endTime) <= nowSec() : false;

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
                      {st === undefined ? "loading…" : incompatible ? "(incompatible)" : st?.item || "(unknown)"}
                    </div>
                    {st && (
                      <div>
                        {!st.settled && !ended && <span style={{ fontSize: 12, color: "#50e3a4" }}>Ongoing</span>}
                        {!st.settled && ended && <span style={{ fontSize: 12, color: "#ffca70" }}>Ended</span>}
                        {st.settled && <span style={{ fontSize: 12, color: "#75a7ff" }}>Settled</span>}
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
