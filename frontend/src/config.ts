// frontend/src/config.ts

/** Chain: Sepolia */
export const CHAIN_ID = 11155111 as const;

/** RPC endpoints dùng để đọc fallback trong trình duyệt (đã bật CORS) */
export const RPCS: string[] = [
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
  "https://ethereum-sepolia.publicnode.com",
];

/**
 * Nguồn danh sách địa chỉ auctions:
 * 1) Biến môi trường VERCEL/Local: VITE_AUCTIONS="0xabc...,0xdef...,0x123..."
 * 2) Nếu không set biến môi trường, dùng mảng AUCTIONS dưới đây.
 */

function parseEnvAuctions(): string[] {
  const raw = (import.meta as any)?.env?.VITE_AUCTIONS ?? "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));
}

/** 👉👉 Điền sẵn địa chỉ nếu bạn chưa dùng env VITE_AUCTIONS */
export const AUCTIONS: string[] = (() => {
  const fromEnv = parseEnvAuctions();
  if (fromEnv.length) return fromEnv;
  return [
    // "0xc343AD8741E9395b46165479388C6c81D63b2b44",
    // "0x556111cc5B8Bce8c59B000000000000000000000",
  ];
})();

/** (Tuỳ chọn) Metadata hiển thị đẹp cho từng auction */
export const AUCTION_META = {
  // "0xc343AD8741E9395b46165479388C6c81D63b2b44": {
  //   title: "Rare NFT #1",
  //   image: "https://picsum.photos/seed/auction1/300/180",
  //   description: "Demo FHE auction",
  // },
} as const;
