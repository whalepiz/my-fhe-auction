import { BrowserProvider } from "ethers";

export type WalletState = { address: string | null; chainId: number | null };

export async function connectWallet(): Promise<WalletState> {
  const anyWindow = window as any;
  if (!anyWindow.ethereum) throw new Error("MetaMask not found");
  const provider = new BrowserProvider(anyWindow.ethereum);
  await anyWindow.ethereum.request({ method: "eth_requestAccounts" });
  const signer = await provider.getSigner();
  const addr = await signer.getAddress();
  const net = await provider.getNetwork();
  return { address: addr, chainId: Number(net.chainId) };
}

