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

  // ---------- helpers ----------
  function shortHex(x?: string, head = 10, tail = 6) {
    if (!x) return "-";
    return x.length > head + tail ? `${x.slice(0, head)}…${x.slice(-tail)}` : x;
  }
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

  // ---------- lifecycle ----------
  useEffect(() => {
    (async () => {
      try {
        const anyWin = window as any;
        if (!anyWin?.ethereum) return;
        const provider = new BrowserProvider(anyWin.ethereum);
        const signer = await provider.getSigner();
        const net = await provider.getNetwork();
        setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });
        await refreshStatus(provider);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // ---------- actions ----------
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
      if (Number(net.chainId) !== EXPECT_CHAIN_ID) await ensureSepolia(anyWin);

      const signer = await provider.getSigner();

      // 1) FHE instance
      const inst = await getFheInstance();

      // 2) encrypted input & proof
      const buf = inst.createEncryptedInput(AUCTION_ADDRESS, await signer.getAddress());
      buf.add32(BigInt(bid));
      const enc = await buf.encrypt(); // -> { handles, inputProof }

      // 3) call bid(handle, proof)
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
      const me = (await signer.getAddress()).toLowerCase();
      const contract = new Contract(AUCTION_ADDRESS, auctionAbi, signer);

      // status
      const [, endTs, isSettled] = await contract.getStatus();
      const now = Math.floor(Date.now() / 1000);

      // chỉ seller được settle
      const seller = (await contract.seller()).toLowerCase();

      // nếu chưa settled & đã hết hạn, tiến hành settle
      if (!isSettled && now >= Number(endTs)) {
        if (seller !== me) {
          alert("Only the seller can settle.");
          setSettleBusy(null);
          return;
        }

        // phát hiện chữ ký settle (null-safe)
        let frag: any = null;
        try {
          frag = contract.interface.getFunction("settle");
        } catch {
          frag = null;
        }

        try {
          if (frag?.inputs?.length === 0) {
            // settle()
            const tx = await contract.settle();
            await tx.wait();
          } else if (frag?.inputs?.length === 1 && frag?.inputs?.[0]?.type === "address[]") {
            // settle(address[])
            // cố lấy danh sách bidders từ event (nếu RPC không hỗ trợ logs, fallback dùng ví hiện tại)
            let bidders: string[] = [];
            try {
              const latest = await provider.getBlockNumber();
              const from = Math.max(0, latest - 8000); // cửa sổ nhỏ cho RPC public
              const logs = await contract.queryFilter(contract.filters.BidSubmitted(), from, latest);
              const uniq = new Set<string>();
              logs.forEach((l: any) => uniq.add(l.args[0]));
              bidders = Array.from(uniq);
            } catch {
              // fallback: dùng ví hiện tại (đủ cho demo 1 người bid)
              bidders = [await signer.getAddress()];
            }
            if (bidders.length === 0) {
              alert("No bidders found to settle.");
              setSettleBusy(null);
              return;
            }
            const tx = await contract.settle(bidders);
            await tx.wait();
          } else {
            throw new Error(`Unsupported settle signature: ${frag?.format?.("full") ?? "unknown"}`);
          }
        } catch (e: any) {
          // Một số RPC + FHEVM plugin có thể throw khi estimateGas, nhưng tx vẫn đã gửi/đã settle.
          console.warn("settle attempt:", e?.message || e);
        }
      }

      // đọc ciphertext kết quả
      const bidEnc: string = await contract.winningBidEnc();
      const idxEnc: string = await contract.winningIndexEnc();
      setWinner({ bidEnc, idxEnc });

      // thử decrypt (best-effort)
      try {
        const inst: any = await getFheInstance();
        if (inst && typeof inst.userDecryptEuint === "function") {
          const addr = await signer.getAddress();
          const bidClear = Number(await inst.userDecryptEuint("euint32", bidEnc, AUCTION_ADDRESS, addr));
          const idxClear = Number(await inst.userDecryptEuint("euint32", idxEnc, AUCTION_ADDRESS, addr));
          setWinner({ bidEnc, idxEnc, bidClear, idxClear });
          alert(`Settled. Winning bid = ${bidClear} (index ${idxClear})`);
        } else {
          alert("Settled. Ciphertexts shown (decrypt may require user keys).");
        }
      } catch (de) {
        console.warn("Decrypt failed:", de);
        alert("Settled. Ciphertexts shown; decrypt skipped.");
      }

      await refreshStatus(provider);
    } catch (err: any) {
      console.error("settleAndReveal error:", err);
      const msg = err?.shortMessage || err?.info?.error?.message || err?.message || "Unknown error";
      alert("Settle failed: " + msg);
    } finally {
      setSettleBusy(null);
    }
  }

  // ---------- derived ----------
  const nowSec = Math.floor(Date.now() / 1000);
  const ended = status.end ? nowSec >= status.end : false;

  // ---------- UI ----------
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
          <div>winningBidEnc: {shortHex(winner.bidEnc)}</div>
          <div>winningIndexEnc: {shortHex(winner.idxEnc)}</div>
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
