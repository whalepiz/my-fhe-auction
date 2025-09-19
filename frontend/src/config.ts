// frontend/src/config.ts

// Luôn là number
export const CHAIN_ID: number = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

// Lấy danh sách địa chỉ từ ENV VITE_AUCTIONS (phân tách bởi dấu phẩy)
const rawEnv: string = String(import.meta.env.VITE_AUCTIONS ?? "");
const envAddrs: string[] = rawEnv
  .split(",")
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

// Nếu không set ENV, bạn có thể để fallback địa chỉ cứng ở đây (tùy chọn)
// ví dụ: const fallback: string[] = ["0x..."];
const fallback: string[] = [];

// Export cuối cùng (có type rõ ràng)
export const AUCTIONS: string[] = envAddrs.length ? envAddrs : fallback;

// Metadata hiển thị (tùy chọn)
export const AUCTION_META: Record<
  string,
  { title: string; image?: string; description?: string }
> = {
  // Ví dụ:
  // "0xYourAddress": {
  //   title: "Rare NFT #X",
  //   image: "https://...",
  //   description: "Mô tả ngắn…",
  // },
};
