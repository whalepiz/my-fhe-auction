export const CHAIN_ID: number = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

const rawEnv: string = String(import.meta.env.VITE_AUCTIONS ?? "");
export const AUCTIONS: string[] = rawEnv
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

export const AUCTION_META: Record<string, { title: string; image?: string; description?: string }> = {};
