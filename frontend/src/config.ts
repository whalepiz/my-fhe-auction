export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

const raw =
  (import.meta.env.VITE_AUCTIONS as string | undefined) ??
  (import.meta.env.VITE_AUCTION_ADDRESS as string | undefined) ??
  "";

export const AUCTIONS: string[] = raw
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);
