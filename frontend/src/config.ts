// frontend/src/config.ts
const envChain = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

function parseAuctionsFromEnv(): string[] {
  const raw = (import.meta.env.VITE_AUCTIONS ?? "") as string;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));
}

export const CHAIN_ID = envChain;

// Danh sách mặc định (nếu muốn hardcode thêm thì điền vào mảng dưới)
export const AUCTIONS = parseAuctionsFromEnv();

// (tuỳ chọn) metadata hiển thị đẹp
export const AUCTION_META = {
  // "0xYourAddressHere": { title: "Rare NFT #1", image: "", description: "" },
} as const;
