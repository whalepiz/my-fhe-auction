import { useState } from "react";
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

  async function connect() {
    const anyWin = window as any;
    if (!anyWin.ethereum) return alert("MetaMask not found");

    const sepoliaHex = "0xaa36a7"; // 11155111
    // Thử chuyển sang Sepolia trước
    try {
      await anyWin.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: sepoliaHex }],
      });
    } catch (err: any) {
      // Nếu Sepolia chưa có trong MM -> thêm rồi chuyển
      if (err?.code === 4902) {
        await anyWin.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: sepoliaHex,
            chainName: "Sepolia",
            nativeCurrency: { name: "SepoliaETH", symbol: "SEP", decimals: 18 },
            rpcUrls: ["https://eth-sepolia.public.blastapi.io", "https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          }],
        });
        await anyWin.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: sepoliaHex }],
        });
      } else {
        console.error("switch chain error:", err);
        alert(`Please switch MetaMask to Sepolia (chainId ${EXPECT_CHAIN_ID}).`);
        return;
      }
    }

    // Đã ở Sepolia -> connect
    const provider = new BrowserProvider(anyWin.ethereum);
    await anyWin.ethereum.request({ method: "eth_requestAccounts" });
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    setWallet({ address: await signer.getAddress(), chainId: Number(net.chainId) });
  }

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.address) return alert("Connect wallet first");

    // kiểm tra số nguyên không âm
    if (!/^\d+$/.test(bid)) return alert("Bid must be a non-negative integer");

    const anyWin = window as any;
    const provider = new BrowserProvider(anyWin.ethereum);

    // nếu đang ở chain khác -> gọi connect() để auto switch
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== EXPECT_CHAIN_ID) {
      await connect();
    }

    const signer = await provider.getSigner();

    // 1) Khởi tạo FHE instance cho Sepolia
    const inst = await getFheInstance();

    // 2) Tạo encrypted input & proof
    const buf = inst.createEncryptedInput(AUCTION_ADDRESS, await signer.getAddress());
    buf.add32(BigInt(bid));
    const enc = await buf.encrypt(); // => { handles: [bytes32,...], inputProof: bytes }

    // 3) Gọi contract bid(handle, proof)
    const contract = new Contract(AUCTION_ADDRESS, auctionAbi, signer);
    const tx = await contract.bid(enc.handles[0], enc.inputProof);
    await tx.wait();

    alert(`Submitted encrypted bid = ${bid}`);
    setBid("");
  }

  return (
    <div style={{ maxWidth: 560, margin: "40px auto", fontFamily: "Inter, system-ui" }}>
      <h1>FHE Auction</h1>

      <p style={{ opacity: 0.7 }}>
        {wallet.address ? `Connected ${wallet.address.slice(0,6)}… (chain ${wallet.chainId})` : "Not connected"}
      </p>
      <button onClick={connect} style={{ padding: "10px 16px", borderRadius: 8 }}>
        {wallet.address ? "Reconnect" : "Connect Wallet"}
      </button>

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
        <button type="submit" style={{ padding: "10px 16px", borderRadius: 8 }}>
          Submit encrypted bid
        </button>
      </form>

      <p style={{marginTop:16, fontSize:12, opacity:0.7}}>
        Contract: {AUCTION_ADDRESS} · Chain: {EXPECT_CHAIN_ID}
      </p>
    </div>
  );
}
