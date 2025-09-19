import { useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { getFheInstance } from "./lib/fhe";
import auctionAbiJson from "./abi/FHEAuction.json";

const AUCTION_ADDRESS = import.meta.env.VITE_AUCTION_ADDRESS as string;
const EXPECT_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
const auctionAbi = (auctionAbiJson as any).abi;

type Wallet = { address: string | null; chainId: number | null };

export default function App() {
  const [wallet, setWallet] = useState<Wallet>({ address: null, chainId: null });
  const [bid, setBid] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [settleBusy, setSettleBusy] = useState<string | null>(null);

  const [status, setStatus] = useState<{ item?: string; end?: number; settled?: boolean }>({});
  const [winner, setWinner] = useState<{
    bidEnc?: string;
    idxEnc?: string;
    bidClear?: number;
    idxClear?: number;
  }>({});

  useEffect(() => {
    // auto connect nhẹ nếu user đã mở MetaMask sẵn
    (async () => {
      try {
        const anyWin = window as any;
        if (!anyWin?.ethereum) return;
        const provider = new BrowserProvider(anyWin.ethereum);
        const net = await provider.getNetwork();
        setWallet({
          address: (await (await provider.getSigner()).getAddress()).toString(),
          chainId: Number(net.chainId),
        });
        await refreshStatus(provider);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  function fmtTs(ts?: number) {
    if (!ts) return "-";
    const d = new Date(ts * 1000);
    return `${d.toLocaleString()} (${ts})`;
  }

  async function ensureSepolia(anyWin: any) {
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
        throw err;
      }
    }
  }

  async function refreshStatus(provider?: BrowserProvider) {
    try {
      const p = provider ?? new BrowserProvider((window as any).ethereum);
      const signer = await p.getSigner();
      const c = new Contract(AUCTION_ADDRESS, auctionAbi, signer);
      const [item, endTs, isSettled] = await c.getStatus();
      setStatus({ item, end: Number(endTs), settled: Boolean(isSettled) });
    } catch (e) {
      console.warn("refreshStatus:", e);
    }
  }

  async function connect() {
    const anyWin = window as any;
    if (!anyWin.ethereum) return alert("MetaMask not found");
    await ensureSepolia(anyWin);

    const provider = new BrowserProvider(anyWin.ethereum);
    await anyWin.ethereum.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });

    await refreshStatus(provider);
  }

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.address) return alert("Connect wallet first");
    if (!/^\d+$/.test(bid)) return alert("Bid must be a non-negative integer");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    try {
      setBusy("Encrypting bid…");

      // đảm bảo đúng chain
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== EXPECT_CHAIN_ID) {
        await ensureSepolia(anyWin);
      }
      const signer = await provider.getSigner();

      // 1) Khởi tạo FHE instance
      const inst = await getFheInstance();

      // 2) Tạo encrypted input & proof
      const buf = inst.createEncryptedInput(AUCTION_ADDRESS, await signer.getAddress());
      buf.add32(BigInt(bid));
      const enc = await buf.encrypt(); // -> { handles, inputProof }

      // 3) Gọi contract bid(handle, proof)
      setBusy("Sending transaction…");
      const contract = new Contract(AUCTION_ADDRESS, auctionAbi, signer);
      const tx = await contract.bid(enc.handles[0], enc.inputProof);
      await tx.wait();

      alert(`Submitted encrypted bid = ${bid}`);
      setBid("");
      await refreshStatus(provider);
    } catch (err: any) {
      console.error("submitBid error:", err);
      const msg =
        err?.shortMessage ||
        err?.info?.error?.message ||
        err?.message ||
        "Unknown error. Open console for details.";
      alert("Bid failed: " + msg);
    } finally {
      setBusy(null);
    }
  }

  async function settleAndReveal() {
    try {
      setSettleBusy("Processing…");
      const anyWin = window as any;
      if (!anyWin.ethereum) return alert("MetaMask not found");
      await ensureSepolia(anyWin);

      const provider = new BrowserProvider(anyWin.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(AUCTION_ADDRESS, auctionAbi, signer);

      // nếu chưa settle và đã hết hạn thì settle
      const [, endTs, isSettled] = await contract.getStatus();
      const now = Math.floor(Date.now() / 1000);
      if (!isSettled && now >= Number(endTs)) {
        const tx = await contract.settle();
        await tx.wait();
      }

      // đọc ciphertext kết quả
      const bidEnc: string = await contract.winningBidEnc();
      const idxEnc: string = await contract.winningIndexEnc();
      setWinner({ bidEnc, idxEnc });

      // thử decrypt (best-effort)
      try {
        const inst: any = await getFheInstance();
        if (inst && typeof inst.userDecryptEuint === "function") {
          // một số SDK cần kiểu & address; nếu không khớp sẽ ném lỗi (đã catch)
          const addr = await signer.getAddress();
          const bidClear = Number(await inst.userDecryptEuint("euint32", bidEnc, AUCTION_ADDRESS, addr));
          const idxClear = Number(await inst.userDecryptEuint("euint32", idxEnc, AUCTION_ADDRESS, addr));
          setWinner({ bidEnc, idxEnc, bidClear, idxClear });
          alert(`Settled. Winning bid = ${bidClear} (index ${idxClear})`);
        } else {
          alert("Settled. Ciphertexts shown; decrypt may require relayer user keys.");
        }
      } catch (de) {
        console.warn("Decrypt failed:", de);
        alert("Settled. Ciphertexts shown; decrypt skipped.");
      }

      await refreshStatus(provider);
    } catch (err: any) {
      console.error("settleAndReveal error:", err);
      const msg = err?.shortMessage || err?.message || err;
      alert("Settle failed: " + msg);
    } finally {
      setSettleBusy(null);
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ended = status.end ? nowSec >= status.end : false;

  return (
    <div style={{ maxWidth: 560, margin: "40px auto", fontFamily: "Inter, system-ui" }}>
      <h1>FHE Auction</h1>

      <p style={{ opacity: 0.7 }}>
        {wallet.address ? `Connected ${wallet.address.slice(0, 6)}… (chain ${wallet.chainId})` : "Not connected"}
      </p>
      <button onClick={connect} style={{ padding: "10px 16px", borderRadius: 8 }}>
        {wallet.address ? "Reconnect" : "Connect Wallet"}
      </button>

      {/* status box */}
      <div style={{ marginTop: 16, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
        <div><b>Item:</b> {status.item ?? "-"}</div>
        <div><b>End time:</b> {fmtTs(status.end)} {status.end ? (ended ? "· ended" : "· ongoing") : ""}</div>
        <div><b>Settled:</b> {String(status.settled ?? false)}</div>
        <button onClick={() => refreshStatus()} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 8 }}>
          Refresh status
        </button>
      </div>

      <hr style={{ margin: "24px 0" }} />

      <form onSubmit={submitBid} style={{ display: "grid", gap: 12 }}>
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
        <button type="submit" disabled={!!busy} style={{ padding: "10px 16px", borderRadius: 8 }}>
          {busy ? busy : "Submit encrypted bid"}
        </button>
      </form>

      <button
        onClick={settleAndReveal}
        disabled={!!settleBusy}
        style={{ padding: "10px 16px", borderRadius: 8, marginTop: 12 }}
      >
        {settleBusy ? settleBusy : "Settle & reveal"}
      </button>

      {winner.bidEnc && (
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
          <div>winningBidEnc: {winner.bidEnc.slice(0, 10)}…{winner.bidEnc.slice(-6)}</div>
          <div>winningIndexEnc: {winner.idxEnc?.slice(0, 10)}…{winner.idxEnc?.slice(-6)}</div>
          {typeof winner.bidClear === "number" && (
            <div style={{ marginTop: 6 }}>
              <b>Winner:</b> bid = {winner.bidClear}, index = {winner.idxClear}
            </div>
          )}
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>
        Contract: {AUCTION_ADDRESS} · Chain: {EXPECT_CHAIN_ID}
      </p>
    </div>
  );
}
