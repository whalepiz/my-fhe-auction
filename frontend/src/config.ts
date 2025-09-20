// frontend/src/config.ts
// ---- Named exports để Vercel không còn TS2614 ----

export const CHAIN_ID = 11155111;

// Nhiều RPC để đọc/fallback
export const RPCS = [
  "https://ethereum-sepolia.publicnode.com",
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
  "https://rpc2.sepolia.org",
];

// Đọc địa chỉ từ ENV (Vercel: VITE_AUCTIONS hoặc VITE_AUCTION_ADDRESS)
function parseEnvAddresses(): string[] {
  const envMulti = (import.meta as any)?.env?.VITE_AUCTIONS as string | undefined;
  const one = (import.meta as any)?.env?.VITE_AUCTION_ADDRESS as string | undefined;
  const addrs: string[] = [];
  if (envMulti) {
    envMulti.split(/[,\s]+/g).forEach((a) => a && addrs.push(a.trim()));
  }
  if (one) addrs.push(one.trim());
  return Array.from(new Set(addrs.filter((x) => /^0x[a-fA-F0-9]{40}$/.test(x))));
}

export const AUCTIONS: string[] = parseEnvAddresses();

// (tuỳ chọn) metadata hiển thị đẹp
export const AUCTION_META: Record<
  string,
  { title: string; image?: string; description?: string }
> = {
  // Ví dụ:
  // "0x493cCee58Db9158cB3689a1c3a09E2726837aFfD": {
  //   title: "Rare NFT #1",
  //   image: "https://…",
  //   description: "Mô tả…",
  // },
};
