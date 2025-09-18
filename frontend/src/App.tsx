import { useState } from "react";
import { connectWallet, type WalletState } from "./lib/wallet";

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, chainId: null });
  const [bid, setBid] = useState("");

  async function onConnect() {
    try { setWallet(await connectWallet()); }
    catch (e: any) { alert(e.message ?? String(e)); }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.address) return alert("Please connect wallet first");
    if (!/^\d+$/.test(bid)) return alert("Bid must be a positive integer");
    alert(`(demo) will encrypt & send bid=${bid} from ${wallet.address} in next step`);
  }

  return (
    <div style={{ maxWidth: 560, margin: "40px auto", fontFamily: "Inter, system-ui" }}>
      <h1>FHE Auction (demo)</h1>
      <p style={{ opacity: 0.7 }}>
        Status: {wallet.address ? `Connected ${wallet.address.slice(0,6)}… on chain ${wallet.chainId}` : "Not connected"}
      </p>

      <button onClick={onConnect} style={{ padding: "10px 16px", borderRadius: 8 }}>
        {wallet.address ? "Reconnect" : "Connect Wallet"}
      </button>

      <hr style={{ margin: "24px 0" }} />

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          Your bid (uint32)
          <input
            type="number" min={0} step={1} value={bid}
            onChange={(e) => setBid(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
          />
        </label>
        <button type="submit" style={{ padding: "10px 16px", borderRadius: 8 }}>
          Submit (encrypt next step)
        </button>
      </form>
    </div>
  );
}
