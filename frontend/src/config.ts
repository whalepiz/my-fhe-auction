// frontend/src/config.ts
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

// Lấy từ ENV nếu có (VITE_AUCTIONS = "0x...,0x...")
const envAddrs = (import.meta.env.VITE_AUCTIONS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Nếu không set ENV, bạn có thể fallback hard-code:
export const AUCTIONS = envAddrs.length ? envAddrs : [
  // "0xYourDefaultAddress"
];

export const AUCTION_META = {
  // "0xYourAddress": {
  //   title: "Rare NFT #X",
  //   image: "https://...",
  //   description: "Short description…",
  // },
} as const;
