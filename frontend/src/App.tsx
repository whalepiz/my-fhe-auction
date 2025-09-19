import { useEffect, useMemo, useState } from "react";
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
import { AUCTIONS, CHAIN_ID, AUCTION_META } from "./config";

const auctionAbi = (auctionAbiJson as any).abi;
const auctionBytecode: string | undefined = (auctionAbiJson as any)?.bytecode;

/* ======================== TYPES ======================== */
type Wallet = { address: string | null; chainId: number | null };

type AuctionStatus = {
  item: string;
  endTime: bigint;
  settled: boolean;
  winningBidEnc?: string;
  winningIndexEnc?: string;
};

/* ======================== HELPERS ======================== */
function fmtTs(ts?: bigint) {
  if (!ts) return "-";
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}
function nowSec() {
  return Math.floor(Date.now() / 1000);
}
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

/* RPCs có CORS mở */
const RPCS = [
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
  "https://ethereum-sepolia.publicnode.com",
  "https://rpc2.sepolia.org",
];

/* Đọc trạng thái CHỈ qua RPC công cộng để tránh BAD_DATA từ BrowserProvider */
const USE_BROWSER_READ = false;

async function getBrowserReadProvider(): Promise<BrowserProvider | null> {
  if (!USE_BROWSER_READ) return null;
  const anyWin = window as any;
  if (!anyWin.ethereum) return null;
  try {
    const p = new BrowserProvider(anyWin.ethereum);
    const net = await p.getNetwork();
    if (Number(net.chainId) === CHAIN_ID) return p;
  } catch {}
  return null;
}

async function tryProviders<T>(
  call: (p: BrowserProvider | JsonRpcProvider) => Promise<T>
): Promise<T> {
  const tried: string[] = [];
  const browserP = await getBrowserReadProvider();
  if (browserP) {
    try {
      return await call(browserP);
    } catch (e: any) {
      tried.push("BrowserProvider");
      console.warn("BrowserProvider failed:", e?.code, e?.value, e?.message);
    }
  }
  let lastErr: any;
  for (const url of RPCS) {
    const p = new JsonRpcProvider(url);
    try {
      return await call(p);
    } catch (e: any) {
      lastErr = e;
      tried.push(url);
      console.warn("RPC failed:", url, e?.code, e?.value, e?.message);
      continue;
    }
  }
  console.warn("All providers failed:", tried, lastErr);
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
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (
      e?.code === "BAD_DATA" ||
      e?.value === "0x" ||
      /bad data|invalid|selector|reverted/i.test(msg)
    ) {
      console.warn(`Address ${addr} incompatible:`, msg);
      return null;
    }
    console.error("safeReadStatus unexpected:", addr, e);
    return null;
  }
}

/* ======================== UI bits ======================== */
function Badge({
  color,
  children,
}: {
  color: "green" | "gray" | "orange" | "blue";
  children: any;
}) {
  const bg =
    color === "green"
      ? "#e8f9f0"
      : color === "orange"
      ? "#fff4e5"
      : color === "blue"
      ? "#eaf3ff"
      : "#f3f4f6";
  const tx =
    color === "green"
      ? "#057a55"
      : color === "orange"
      ? "#ad5700"
      : color === "blue"
      ? "#0b5ed7"
      : "#374151";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: bg,
        color: tx,
        border: `1px solid ${tx}20`,
      }}
    >
      {children}
    </span>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null as any;
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "10px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.07)",
        maxWidth: 360,
        zIndex: 9999,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Thông báo</div>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{text}</div>
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8 }}>
          OK
        </button>
      </div>
    </div>
  );
}

function Modal({
  open,
  children,
  onClose,
  title,
}: {
  open: boolean;
  children: any;
  onClose: () => void;
  title: string;
}) {
  if (!open) return null as any;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "center",
        zIndex: 9998,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 92vw)",
          background: "white",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          padding: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8 }}>
            ✕
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ======================== APP ======================== */
export default function App() {
  /* Wallet */
  const [wallet, setWallet] = useState<Wallet>({ address: null, chainId: null });
  async function connect() {
    const anyWin = window as any;
    if (!anyWin.ethereum) return alert("MetaMask không tìm thấy");

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
        console.error("switch chain error:", err);
        alert(`Hãy chuyển MetaMask sang Sepolia (chainId ${CHAIN_ID}).`);
        return;
      }
    }

    const provider = new BrowserProvider(anyWin.ethereum);
    await anyWin.ethereum.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });
  }

  /* Danh sách auction (có thể thêm mới từ UI) */
  const initialAddresses = useMemo(() => (AUCTIONS.length ? AUCTIONS : []), []);
  const [addrList, setAddrList] = useState<string[]>(initialAddresses);
  const [active, setActive] = useState<string>(initialAddresses[0] ?? "");
  const [listStatus, setListStatus] = useState<Record<string, AuctionStatus | null>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [toast, setToast] = useState("");

  /* Create auction modal */
  const [openCreate, setOpenCreate] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [newMinutes, setNewMinutes] = useState<number>(10);
  const [creating, setCreating] = useState(false);

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
          if (res.status !== "fulfilled") console.error("load status fail", addr, res.reason);
        });
        setListStatus(map);
      } catch (e) {
        console.error("load list status (outer):", e);
      } finally {
        setLoadingList(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrList.join(",")]);

  /* Active detail */
  const [bid, setBid] = useState("");
  const [busy, setBusy] = useState<null | string>(null);
  const [detail, setDetail] = useState<AuctionStatus | null>(null);
  const ended = detail ? Number(detail.endTime) <= nowSec() : false;

  async function refreshDetail() {
    if (!active) return;
    const st = await safeReadStatus(active);
    setDetail(st);
    setListStatus((old) => ({ ...old, [active]: st }));
  }

  useEffect(() => {
    refreshDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Countdown re-render
  useEffect(() => {
    if (!detail || ended) return;
    const t = setInterval(() => setDetail((d) => (d ? { ...d } : d)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.endTime, ended]);

  /* Actions */
  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.address) return setToast("Hãy kết nối ví trước.");
    if (!detail) return setToast("Địa chỉ không tương thích FHEAuction.");
    if (!/^\d+$/.test(bid)) return setToast("Bid phải là số nguyên không âm.");
    if (ended) return setToast("Phiên đã kết thúc.");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    try {
      setBusy("Đang mã hoá bid…");
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();

      const inst = await getFheInstance();
      const buf = inst.createEncryptedInput(active, await signer.getAddress());
      buf.add32(BigInt(bid));
      const enc = await buf.encrypt();

      setBusy("Gửi giao dịch…");
      const contract = new Contract(active, auctionAbi, signer);
      const tx = await contract.bid(enc.handles[0], enc.inputProof);
      await tx.wait();

      setToast(`Đã gửi bid (encrypted) = ${bid}`);
      setBid("");
      await refreshDetail();
    } catch (err: any) {
      console.error("submitBid error:", err);
      const msg =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Bid thất bại: " + msg);
    } finally {
      setBusy(null);
    }
  }

  async function settleAndReveal() {
    if (!active) return;
    if (!detail) return setToast("Địa chỉ không tương thích.");
    if (!ended) return setToast("Chưa hết hạn.");

    try {
      const anyWin = window as any;
      if (!anyWin.ethereum) return setToast("Hãy kết nối ví.");

      const provider = new BrowserProvider(anyWin.ethereum);
      const signer = await provider.getSigner();
      const c = new Contract(active, auctionAbi, signer);

      const iface = new Interface(auctionAbi);
      let frag: Fragment | null = null;
      try {
        frag = iface.getFunction("settle");
      } catch {}
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
      console.error("settleAndReveal error:", err);
      const msg =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Settle thất bại: " + msg);
    }
  }

  async function createAuction() {
    if (!wallet.address) return setToast("Kết nối ví trước.");
    if (!newItem.trim()) return setToast("Nhập tên Item.");
    const secs = Math.max(60, Math.floor(Number(newMinutes) * 60)); // min 60s

    try {
      const anyWin = window as any;
      const provider = new BrowserProvider(anyWin.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();

      if (!auctionBytecode) {
        return setToast(
          "Thiếu bytecode trong FHEAuction.json. Hãy copy artifact Hardhat (artifact/.../FHEAuction.json) vào frontend/src/abi."
        );
      }

      setCreating(true);
      const factory = new ContractFactory(auctionAbi, auctionBytecode, signer);
      const c = await factory.deploy(newItem.trim(), secs);
      await c.waitForDeployment();

      // ethers v6: địa chỉ ở .target
      // @ts-ignore
      const newAddr: string = c.target;
      setToast(`Deploy thành công: ${newAddr}`);
      setAddrList((old) => [newAddr, ...old]);
      setActive(newAddr);
      setOpenCreate(false);
      setNewItem("");
      setNewMinutes(10);
    } catch (err: any) {
      console.error("createAuction error:", err);
      const msg =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Deploy thất bại: " + msg);
    } finally {
      setCreating(false);
    }
  }

  /* ======================== RENDER ======================== */
  return (
    <div style={{ maxWidth: 1120, margin: "24px auto", fontFamily: "Inter, system-ui", padding: "0 16px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>FHE Auction</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            Fully Homomorphic Encrypted bidding on Sepolia
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => setOpenCreate(true)}
            style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#111827", color: "white" }}
            title="Deploy một phiên đấu giá mới"
          >
            + Create auction
          </button>
          <button onClick={connect} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e5e7eb" }}>
            {wallet.address ? "Reconnect" : "Connect Wallet"}
          </button>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {wallet.address
              ? `Connected ${wallet.address.slice(0, 6)}… (chain ${wallet.chainId})`
              : "Not connected"}
          </div>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 1fr", gap: 16 }}>
        {/* LIST */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Auctions</h3>
            {loadingList && <span style={{ fontSize: 12, opacity: 0.7 }}>Loading…</span>}
          </div>

          <div style={{ display: "grid", gap: 12 }}>
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
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 12,
                    background: isActive ? "#f8f9ff" : "white",
                  }}
                >
                  {meta?.image && (
                    <div style={{ marginBottom: 8 }}>
                      <img
                        src={meta.image}
                        alt={meta?.title || st?.item || "Auction item"}
                        style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 10 }}
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontWeight: 700 }}>
                      {st === undefined
                        ? "loading…"
                        : incompatible
                        ? "(incompatible)"
                        : meta?.title || st?.item || "(unknown)"}
                    </div>
                    {st && (
                      <>
                        {!st.settled && !endedCard && <Badge color="green">Ongoing</Badge>}
                        {!st.settled && endedCard && <Badge color="orange">Ended</Badge>}
                        {st.settled && <Badge color="blue">Settled</Badge>}
                      </>
                    )}
                  </div>
                  {meta?.description && (
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                      {meta.description}
                    </div>
                  )}

                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    End: {incompatible ? "-" : st ? (Number(st.endTime) > nowSec() ? "ongoing" : "ended") : "-"} ·{" "}
                    {st ? fmtTs(st.endTime) : "-"}
                    {st && Number(st.endTime) > nowSec() && (
                      <> · <span style={{ fontWeight: 600 }}>{fmtRemain(Number(st.endTime) - nowSec())}</span></>
                    )}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                    Settled: {incompatible ? "-" : st?.settled ? "true" : "false"}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <button
                      onClick={() => setActive(addr)}
                      disabled={incompatible}
                      style={{ padding: "6px 10px", borderRadius: 8, opacity: incompatible ? 0.5 : 1 }}
                    >
                      Open
                    </button>
                    <a
                      href={`https://sepolia.etherscan.io/address/${addr}`}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 12 }}
                    >
                      Etherscan
                    </a>
                    <code
                      onClick={() =>
                        navigator.clipboard?.writeText(addr).then(() => setToast("Đã copy địa chỉ hợp đồng."))
                      }
                      title="Copy"
                      style={{ fontSize: 11, opacity: 0.7, cursor: "pointer", userSelect: "none" }}
                    >
                      {addr.slice(0, 8)}…{addr.slice(-6)}
                    </code>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ACTIVE */}
        {!!active && (
          <section style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Active auction</h3>
              <button onClick={refreshDetail} style={{ padding: "6px 10px", borderRadius: 8 }}>
                Refresh status
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
              <div><b>Item:</b> {detail?.item ?? "-"}</div>
              <div>
                <b>End time:</b> {detail ? fmtTs(detail.endTime) : "-"} ·{" "}
                {detail
                  ? Number(detail.endTime) > nowSec()
                    ? <>ongoing · <span style={{ fontWeight: 600 }}>{fmtRemain(Number(detail.endTime) - nowSec())}</span></>
                    : "ended"
                  : "-"}
              </div>
              <div><b>Settled:</b> {detail?.settled ? "true" : "false"}</div>

              {detail?.settled && (
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  <div>winningBidEnc: <code>{detail.winningBidEnc}</code></div>
                  <div>winningIndexEnc: <code>{detail.winningIndexEnc}</code></div>
                </div>
              )}
            </div>

            <form onSubmit={submitBid} style={{ display: "grid", gap: 12, maxWidth: 500, marginTop: 16 }}>
              <label style={{ fontSize: 14 }}>
                Your bid (uint32)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={bid}
                  onChange={(e) => setBid(e.target.value)}
                  disabled={!detail || Number(detail?.endTime || 0) <= nowSec() || !!busy}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd", marginTop: 6 }}
                />
              </label>
              <button
                type="submit"
                disabled={!!busy || !detail || Number(detail?.endTime || 0) <= nowSec()}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: "#111827",
                  color: "white",
                  border: "none",
                  opacity: !!busy || !detail || Number(detail?.endTime || 0) <= nowSec() ? 0.5 : 1,
                }}
              >
                {busy ? busy : "Submit encrypted bid"}
              </button>
            </form>

            <div style={{ marginTop: 12 }}>
              <button
                onClick={settleAndReveal}
                disabled={!detail || !(Number(detail?.endTime || 0) <= nowSec())}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  opacity: !detail || !(Number(detail?.endTime || 0) <= nowSec()) ? 0.5 : 1,
                }}
              >
                Settle & reveal
              </button>
            </div>

            <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
              Active contract: {active} · Chain: {CHAIN_ID}
            </p>
          </section>
        )}
      </div>

      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Create new auction">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Item name
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="e.g. Rare NFT #X"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd", marginTop: 6 }}
            />
          </label>
          <label>
            Duration (minutes)
            <input
              type="number"
              min={1}
              value={newMinutes}
              onChange={(e) => setNewMinutes(Number(e.target.value))}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd", marginTop: 6 }}
            />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setOpenCreate(false)} style={{ padding: "8px 12px", borderRadius: 8 }}>
              Cancel
            </button>
            <button
              onClick={createAuction}
              disabled={creating}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "#111827",
                color: "white",
                border: "none",
                opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? "Deploying…" : "Deploy"}
            </button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Lưu ý: yêu cầu `frontend/src/abi/FHEAuction.json` là **artifact Hardhat** để
            có <code>bytecode</code> phục vụ deploy.
          </div>
        </div>
      </Modal>

      <Toast text={toast} onClose={() => setToast("")} />
    </div>
  );
}
