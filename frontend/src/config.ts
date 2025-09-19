// frontend/src/config.ts

export const CHAIN_ID: number = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

const rawEnv: string = String(import.meta.env.VITE_AUCTIONS ?? "");
const envAddrs: string[] = rawEnv
  .split(",")
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

const fallback: string[] = []; // có thể thêm địa chỉ cứng nếu muốn
export const AUCTIONS: string[] = envAddrs.length ? envAddrs : fallback;

export const AUCTION_META: Record<
  string,
  { title: string; image?: string; description?: string }
> = {
  // "0xYourAddr": { title: "Rare NFT #1", image: "https://…", description: "…" }
};
