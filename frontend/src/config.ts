export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

// Lấy danh sách địa chỉ từ ENV, chấp nhận ngăn cách bằng dấu phẩy hoặc xuống dòng/space
const listFromEnv: string[] = (import.meta.env.VITE_AUCTIONS ?? "")
  .split(/[\s,]+/)
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

export const AUCTIONS: string[] = listFromEnv.length
  ? listFromEnv
  : (import.meta.env.VITE_AUCTION_ADDRESS
      ? [import.meta.env.VITE_AUCTION_ADDRESS as string]
      : []);
