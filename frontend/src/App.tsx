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
import { AUCTIONS as ENV_AUCTIONS, CHAIN_ID, AUCTION_META } from "./config";

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
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function isAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

/* RPCs có CORS mở */
const RPCS = [
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
  "https://ethereum-sepolia.publicnode.com",
  "https://rpc2.sepolia.org",
];

/* Đọc trạng thái CHỈ qua RPC công để tránh BAD_DATA từ BrowserProvider */
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

/* ====== PERSIST danh sách auction trong localStorage ====== */
const LS_KEY = "fhe_auctions";
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

/* ====== CHỜ PUBLIC KEY + ENCRYPT RETRY ====== */
async function waitPublicKey(contractAddr: string, setBusy?: (s: string | null) => void) {
  try {
    const inst = await getFheInstance();
    if ((inst as any)?.waitForPublicKey) {
      setBusy?.("Preparing FHE key…");
      await (inst as any).waitForPublicKey(contractAddr, { timeoutMs: 120000 });
      return;
    }
    // SDK cũ: poll getPublicKey
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

// Kiểm tra key sẵn sàng → để bật/tắt nút tự động
async function isFheReady(contractAddr: string): Promise<boolean> {
  try {
    const inst = await getFheInstance();
    if ((inst as any)?.waitForPublicKey) {
      await (inst as any).waitForPublicKey(contractAddr, { timeoutMs: 1 });
      return true;
    }
    if ((inst as any)?.getPublicKey) {
      await (inst as any).getPublicKey(contractAddr);
      return true;
    }
    return true;
  } catch {
    return false;
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
    } catch (e: any) {
      const msg = String(e?.message || "");
      const retriable = /REQUEST FAILED|500|public key|gateway|relayer|fetch|timeout/i.test(msg);
      if (!retriable || i === 10) throw e;
      await sleep(1000 * i); // 1s..10s
    }
  }
  throw new Error("FHE key chưa sẵn sàng.");
}

/* Decode custom error để thấy lý do revert thực sự */
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

/* ======================== UI bits (dark theme) ======================== */
function Badge({
  color,
  children,
}: {
  color: "green" | "gray" | "orange" | "blue";
  children: any;
}) {
  const bg = color === "green" ? "#103e2a" : color === "orange" ? "#3f2b00" : color === "blue" ? "#0b274d" : "#2a2d35";
  const tx = color === "green" ? "#50e3a4" : color === "orange" ? "#ffca70" : color === "blue" ? "#75a7ff" : "#cbd5e1";
  return <span className="badge" style={{ background: bg, color: tx }}>{children}</span>;
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null as any;
  return (
    <div className="toast">
      <div className="toast__title">Thông báo</div>
      <div className="toast__body">{text}</div>
      <div className="toast__footer">
        <button onClick={onClose} className="btn">OK</button>
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
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{title}</h3>
          <button onClick={onClose} className="btn">✕</button>
        </div>
        <div className="modal__content">{children}</div>
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

  /* Danh sách auction (persist + thêm mới) */
  const initialAddresses = useMemo(initialAddrList, []);
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

  // Persist LS
  useEffect(() => { saveLocalAddrs(addrList); }, [addrList]);

  // Load status list
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
  const [fheReady, setFheReady] = useState<boolean>(false);
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

  // Poll FHE readiness cho active contract
  useEffect(() => {
    let stop = false;
    async function tick() {
      if (!active) return;
      const ok = await isFheReady(active);
      if (!stop) setFheReady(ok);
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [active]);

  /* Actions */
  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.address) return setToast("Hãy kết nối ví trước.");
    if (!detail) return setToast("Địa chỉ không tương thích FHEAuction.");
    if (!/^\d+$/.test(bid)) return setToast("Bid phải là số nguyên không âm.");
    if (ended) return setToast("Phiên đã kết thúc.");
    if (!fheReady) return setToast("FHE key chưa sẵn sàng. Vui lòng đợi vài giây.");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    try {
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) await connect();
      const signer = await provider.getSigner();
      const me = await signer.getAddress();

      // 1) chờ public key (blocking ngắn)
      await waitPublicKey(active, setBusy);

      // 2) encrypt (retry)
      const enc = await encryptBidWithRetry(active, me, BigInt(bid), setBusy);

      // 3) gửi tx
      setBusy("Sending transaction…");
      const contract = new Contract(active, auctionAbi, signer);
      const tx = await contract.bid(enc.handles[0], enc.inputProof);
      await tx.wait();

      setToast(`Đã gửi bid (encrypted) = ${bid}`);
      setBid("");
      await refreshDetail();
    } catch (err: any) {
      console.error("submitBid error:", err);
      const decoded = decodeRevert(err);
      const base =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      const reason = decoded ? ` | Revert: ${decoded}` : "";
      const hint = /execution reverted|InvalidInput|Cipher|Proof|PublicKey/i.test(base + reason)
        ? " (Có thể FHE key/proof chưa sẵn sàng. Đợi thêm 20–60s rồi thử lại.)"
        : "";
      setToast("Bid thất bại: " + base + reason + hint);
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
      // @ts-ignore ethers v6
      const newAddr: string = c.target;

      setToast(`Deploy thành công: ${newAddr}`);
      const next = Array.from(new Set([newAddr, ...addrList]));
      setAddrList(next);
      setActive(newAddr);
      await refreshDetail();
    } catch (err: any) {
      console.error("createAuction error:", err);
      const msg =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      setToast("Deploy thất bại: " + msg);
    } finally {
      setCreating(false);
      setOpenCreate(false);
      setNewItem("");
      setNewMinutes(10);
    }
  }

  /* ======================== RENDER ======================== */
  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="brand">⚡ FHE Auction</div>
          <div className="brand__sub">Anonymous encrypted bidding on Sepolia</div>
        </div>
        <div className="header__actions">
          <button onClick={() => setOpenCreate(true)} className="btn btn--primary">+ Create auction</button>
          <button onClick={connect} className="btn">{wallet.address ? "Reconnect" : "Connect Wallet"}</button>
          <div className="hint">
            {wallet.address
              ? `Connected ${wallet.address.slice(0, 6)}… (chain ${wallet.chainId})`
              : "Not connected"}
          </div>
        </div>
      </header>

      <div className="grid">
        {/* LIST */}
        <section className="card">
          <div className="card__header">
            <h3>Auctions</h3>
            {loadingList && <span className="muted">Loading…</span>}
          </div>

          <div className="list">
            {(addrList.length ? addrList : [""]).map((addr) => {
              const st = listStatus[addr];
              const incompatible = st === null;
              const meta = (AUCTION_META as any)?.[addr];
              const isActive = addr === active;
              const endedCard = st ? Number(st.endTime) <= nowSec() : false;

              return (
                <div key={addr} className={`auction ${isActive ? "auction--active" : ""}`}>
                  {meta?.image && (
                    <img src={meta.image} alt={meta?.title || st?.item || "Auction"} className="auction__img" />
                  )}

                  <div className="auction__title">
                    <div className="title">
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

                  {meta?.description && <div className="muted">{meta.description}</div>}

                  <div className="muted">
                    End: {incompatible ? "-" : st ? (Number(st.endTime) > nowSec() ? "ongoing" : "ended") : "-"} · {st ? fmtTs(st.endTime) : "-"}
                    {st && Number(st.endTime) > nowSec() && <> · <b>{fmtRemain(Number(st.endTime) - nowSec())}</b></>}
                  </div>
                  <div className="muted">Settled: {incompatible ? "-" : st?.settled ? "true" : "false"}</div>

                  <div className="row">
                    <button onClick={() => setActive(addr)} disabled={incompatible} className="btn">Open</button>
                    <a className="link" href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noreferrer">Etherscan</a>
                    <code
                      className="addr"
                      title="Copy"
                      onClick={() => navigator.clipboard?.writeText(addr).then(() => setToast("Đã copy địa chỉ hợp đồng."))}
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
          <section className="card">
            <div className="card__header">
              <h3>Active auction</h3>
              <button onClick={refreshDetail} className="btn">Refresh status</button>
            </div>

            <div className="kv">
              <div><b>Item:</b> {detail?.item ?? "-"}</div>
              <div>
                <b>End time:</b> {detail ? fmtTs(detail.endTime) : "-"} ·{" "}
                {detail ? (Number(detail.endTime) > nowSec()
                  ? <>ongoing · <b>{fmtRemain(Number(detail.endTime) - nowSec())}</b></>
                  : "ended") : "-"}
              </div>
              <div><b>Settled:</b> {detail?.settled ? "true" : "false"}</div>
              {detail?.settled && (
                <div className="muted">
                  <div>winningBidEnc: <code>{detail.winningBidEnc}</code></div>
                  <div>winningIndexEnc: <code>{detail.winningIndexEnc}</code></div>
                </div>
              )}
            </div>

            <form onSubmit={submitBid} className="form">
              <label className="label">
                Your bid (uint32)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={bid}
                  onChange={(e) => setBid(e.target.value)}
                  disabled={!detail || Number(detail?.endTime || 0) <= nowSec() || !!busy || !fheReady}
                  className="input"
                />
              </label>
              <button
                type="submit"
                disabled={!!busy || !detail || Number(detail?.endTime || 0) <= nowSec() || !fheReady}
                className="btn btn--primary"
              >
                {busy ? busy : (fheReady ? "Submit encrypted bid" : "Waiting FHE key…")}
              </button>
            </form>

            <div className="spacer8" />
            <button
              onClick={settleAndReveal}
              disabled={!detail || !(Number(detail?.endTime || 0) <= nowSec())}
              className="btn"
            >
              Settle & reveal
            </button>

            <p className="muted small">
              Active contract: {active} · Chain: {CHAIN_ID}
            </p>
          </section>
        )}
      </div>

      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Create new auction">
        <div className="form">
          <label className="label">
            Item name
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="e.g. Rare NFT #X"
              className="input"
            />
          </label>
          <label className="label">
            Duration (minutes)
            <input
              type="number"
              min={1}
              value={newMinutes}
              onChange={(e) => setNewMinutes(Number(e.target.value))}
              className="input"
            />
          </label>
          <div className="row end">
            <button onClick={() => setOpenCreate(false)} className="btn">Cancel</button>
            <button onClick={createAuction} disabled={creating} className="btn btn--primary">
              {creating ? "Deploying…" : "Deploy"}
            </button>
          </div>
          <div className="muted small">
            Cần file <code>frontend/src/abi/FHEAuction.json</code> là artifact Hardhat (có <code>bytecode</code>).
          </div>
        </div>
      </Modal>

      <Toast text={toast} onClose={() => setToast("")} />
    </div>
  );
}
