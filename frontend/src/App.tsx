import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, Fragment, Interface, JsonRpcProvider } from "ethers";
import { getFheInstance } from "./lib/fhe";
import auctionAbiJson from "./abi/FHEAuction.json";
import { AUCTIONS, CHAIN_ID } from "./config";

const auctionAbi = (auctionAbiJson as any).abi;

type Wallet = { address: string | null; chainId: number | null };

type AuctionStatus = {
  item: string;
  endTime: bigint;
  settled: boolean;
  winningBidEnc?: string;
  winningIndexEnc?: string;
};

// ---- helpers ----
function fmtTs(ts?: bigint) {
  if (!ts) return "-";
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}

// Provider chỉ-đọc: nếu MM ở Sepolia dùng luôn, nếu không dùng RPC công khai
async function getReadOnlyProvider() {
  const anyWin = window as any;
  if (anyWin.ethereum) {
    const p = new BrowserProvider(anyWin.ethereum);
    try {
      const net = await p.getNetwork();
      if (Number(net.chainId) === CHAIN_ID) return p;
    } catch {}
  }
  return new JsonRpcProvider("https://rpc.sepolia.org");
}

// Đọc trạng thái; nếu contract không đúng ABI → trả về null thay vì throw
async function safeReadStatus(addr: string, provider: any): Promise<AuctionStatus | null> {
  try {
    const c = new Contract(addr, auctionAbi, provider);
    const [item, endTime, settled] = await c.getStatus(); // string, uint256, bool
    const st: AuctionStatus = { item, endTime, settled };
    if (settled) {
      st.winningBidEnc = await c.winningBidEnc();
      st.winningIndexEnc = await c.winningIndexEnc();
    }
    return st;
  } catch (e: any) {
    // ethers v6: code BAD_DATA khi decode 0x (hàm không tồn tại)
    if (e?.code === "BAD_DATA" || e?.value === "0x") {
      console.warn(`Address ${addr} is not a compatible FHEAuction (getStatus missing).`);
      return null;
    }
    console.error("safeReadStatus unexpected error:", e);
    return null;
  }
}

export default function App() {
  // —— Wallet ——
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
              rpcUrls: ["https://rpc.sepolia.org", "https://eth-sepolia.public.blastapi.io"],
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

  // —— Danh sách auctions + chọn 1 cái để thao tác ——
  const addresses: string[] = useMemo(() => (AUCTIONS.length ? AUCTIONS : []), []);
  const [active, setActive] = useState<string>(addresses[0] ?? "");
  const [listStatus, setListStatus] = useState<Record<string, AuctionStatus | null>>({});
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    (async () => {
      if (!addresses.length) return;
      try {
        setLoadingList(true);
        const provider = await getReadOnlyProvider();
        const entries = await Promise.all(
          addresses.map(async (addr) => [addr, await safeReadStatus(addr, provider)] as const)
        );
        const map: Record<string, AuctionStatus | null> = {};
        for (const [addr, st] of entries) map[addr] = st;
        setListStatus(map);
      } catch (e) {
        console.error("load list status", e);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [addresses.join(",")]);

  // —— UI trạng thái 1 auction đang active —— 
  const [bid, setBid] = useState("");
  const [busy, setBusy] = useState<null | string>(null);
  const [detail, setDetail] = useState<AuctionStatus | null>(null);

  async function refreshDetail() {
    if (!active) return;
    const provider = await getReadOnlyProvider();
    const st = await safeReadStatus(active, provider);
    setDetail(st);
    setListStatus((old) => ({ ...old, [active]: st }));
  }

  useEffect(() => {
    refreshDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.address) return alert("Connect wallet first");
    if (!detail) return alert("This address is not a compatible FHEAuction.");
    if (!/^\d+$/.test(bid)) return alert("Bid must be a non-negative integer");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    try {
      setBusy("Encrypting bid…");

      const net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) {
        await connect();
      }
      const signer = await provider.getSigner();

      // 1) FHE instance
      const inst = await getFheInstance();

      // 2) encrypted input & proof
      const buf = inst.createEncryptedInput(active, await signer.getAddress());
      buf.add32(BigInt(bid));
      const enc = await buf.encrypt();

      // 3) call contract
      setBusy("Sending transaction…");
      const contract = new Contract(active, auctionAbi, signer);
      const tx = await contract.bid(enc.handles[0], enc.inputProof);
      await tx.wait();

      alert(`Submitted encrypted bid = ${bid}`);
      setBid("");
      await refreshDetail();
    } catch (err: any) {
      console.error("submitBid error:", err);
      const msg =
        err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      alert("Bid failed: " + msg);
    } finally {
      setBusy(null);
    }
  }

  async function settleAndReveal() {
    if (!active) return;
    if (!detail) return alert("This address is not a compatible FHEAuction.");

    try {
      const anyWin = window as any;
      if (!anyWin.ethereum) return alert("Connect wallet first");

      const provider = new BrowserProvider(anyWin.ethereum);
      const signer = await provider.getSigner();
      const c = new Contract(active, auctionAbi, signer);

      const iface = new Interface(auctionAbi);
      const frag: Fragment | null = (() => {
        try { return iface.getFunction("settle"); } catch { return null; }
      })();

      if (!frag) throw new Error("Contract has no settle()");

      const inputs = (frag as any).inputs ?? [];
      let tx;
      if (inputs.length === 0) {
        tx = await c.settle();
      } else if (inputs.length === 1 && inputs[0].type === "address[]") {
        const me = await signer.getAddress();
        tx = await c.settle([me]);
      } else {
        throw new Error(`Unsupported settle signature: ${(frag as any).format("full")}`);
      }
      await tx.wait();

      alert("Settled. Ciphertexts shown (decrypt may require user keys).");
      await refreshDetail();
    } catch (err: any) {
      console.error("settleAndReveal error:", err);
      const msg =
        err?.shortMessage || err?.info?.error?.message || err?.message || "unknown error";
      alert("Settle failed: " + msg);
    }
  }

  // ————— UI —————
  return (
    <div style={{ maxWidth: 980, margin: "24px auto", fontFamily: "Inter, system-ui" }}>
      <h1>FHE Auction</h1>

      {/* Wallet */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button onClick={connect} style={{ padding: "8px 14px", borderRadius: 8 }}>
          {wallet.address ? "Reconnect" : "Connect Wallet"}
        </button>
        <div style={{ opacity: 0.7 }}>
          {wallet.address
            ? `Connected ${wallet.address.slice(0, 6)}… (chain ${wallet.chainId})`
            : "Not connected"}
        </div>
      </div>

      {/* Danh sách auctions */}
      <div style={{ margin: "12px 0 18px" }}>
        <h3>Auctions</h3>
        {loadingList && <div>Loading…</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {(addresses.length ? addresses : [""]).map((addr) => {
            const st = listStatus[addr];
            const incompatible = st === null;
            return (
              <div key={addr} style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: addr === active ? "#f5f5ff" : "white",
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {incompatible ? "(incompatible contract)" : (st?.item || "(unknown item)")}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  End: {incompatible ? "-" : (st ? (Number(st.endTime) > Date.now()/1000 ? "ongoing" : "ended") : "-")} · {st ? fmtTs(st.endTime) : "-"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  Settled: {incompatible ? "-" : (st?.settled ? "true" : "false")}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => setActive(addr)}
                    disabled={incompatible}
                    style={{ padding: "6px 10px", borderRadius: 8, opacity: incompatible ? 0.5 : 1 }}
                  >
                    Open
                  </button>
                  <code style={{ fontSize: 11, opacity: 0.7 }}>{addr.slice(0, 8)}…{addr.slice(-6)}</code>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chi tiết auction đang active */}
      {!!active && (
        <div style={{ borderTop: "1px solid #eee", marginTop: 16, paddingTop: 16 }}>
          <h3>Active auction</h3>

          <div style={{ marginBottom: 8 }}>
            <button onClick={refreshDetail} style={{ padding: "6px 10px", borderRadius: 8 }}>
              Refresh status
            </button>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 8,
            maxWidth: 560
          }}>
            <div><b>Item:</b> {detail?.item ?? "-"}</div>
            <div>
              <b>End time:</b> {detail ? fmtTs(detail.endTime) : "-"} ·{" "}
              {detail ? (Number(detail.endTime) > Date.now()/1000 ? "ongoing" : "ended") : "-"}
            </div>
            <div><b>Settled:</b> {detail?.settled ? "true" : "false"}</div>
            {detail?.settled && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                <div>winningBidEnc: <code>{detail.winningBidEnc}</code></div>
                <div>winningIndexEnc: <code>{detail.winningIndexEnc}</code></div>
              </div>
            )}
          </div>

          <form onSubmit={submitBid} style={{ display: "grid", gap: 12, maxWidth: 560, marginTop: 16 }}>
            <label>
              Your bid (uint32)
              <input
                type="number"
                min={0}
                step={1}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
              />
            </label>
            <button type="submit" disabled={!!busy || !detail} style={{ padding: "10px 16px", borderRadius: 8 }}>
              {busy ? busy : "Submit encrypted bid"}
            </button>
          </form>

          <div style={{ marginTop: 12 }}>
            <button onClick={settleAndReveal} disabled={!detail} style={{ padding: "8px 14px", borderRadius: 8, opacity: !detail ? 0.5 : 1 }}>
              Settle & reveal
            </button>
          </div>

          <p style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>
            Active contract: {active} · Chain: {CHAIN_ID}
          </p>
        </div>
      )}

      {!addresses.length && (
        <div style={{ marginTop: 16, color: "#b91c1c" }}>
          Chưa cấu hình địa chỉ. Hãy set env <code>VITE_AUCTIONS</code> hoặc <code>VITE_AUCTION_ADDRESS</code>.
        </div>
      )}
    </div>
  );
}
