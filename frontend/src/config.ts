// frontend/src/config.ts
export const CHAIN_ID = 11155111;

// Tạm thời chỉ dùng 1 địa chỉ mới (đang "ongoing")
export const AUCTIONS = [
  "0xc343AD8741E9395b46165479388C6c81D63b2b44",
];

// (tuỳ chọn) metadata hiển thị đẹp
export const AUCTION_META = {
  "0xc343AD8741E9395b46165479388C6c81D63b2b44": {
    title: "Rare NFT #3",
    image:
      "https://telos.vn/wp-content/uploads/2022/08/binance-san-giao-dich-tien-dien-tu-lon-nhat-the-gioi-hien-da-mo-tinh-nang-nft-design.jpg",
    description: "Mô tả ngắn gọn NFT #3…",
  },
} as const;
