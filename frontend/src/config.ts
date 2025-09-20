/* frontend/src/config.ts */
export const CHAIN_ID = 11155111; // Sepolia

// Relayer testnet của Zama cho Sepolia
export const RELAYER_URL = "https://relayer.testnet.zama.cloud";

// RPC đọc chuỗi (dùng luân phiên để bền hơn)
export const RPCS: string[] = [
  "https://eth-sepolia.public.blastapi.io",
  "https://ethereum-sepolia.publicnode.com",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
];

// (tùy chọn) seed sẵn một vài contract address nếu muốn, để trống cũng được.
// App sẽ lưu danh sách vào localStorage nên không bắt buộc.
export const AUCTIONS: string[] = [];
export const AUCTION_META: Record<string, { title?: string }> = {};
