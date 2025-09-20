// frontend/src/config.ts
export const CHAIN_ID = 11155111 as const;

// Danh sách RPC dự phòng (đủ CORS)
export const RPCS = [
  "https://eth-sepolia.public.blastapi.io",
  "https://ethereum-sepolia.publicnode.com",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
];

// (tuỳ chọn) khởi tạo sẵn vài contract nếu muốn
export const AUCTIONS: string[] = [
  // "0xYourAuctionAddressHere"
];

// (tuỳ chọn) metadata hiển thị đẹp
export const AUCTION_META = {} as const;
