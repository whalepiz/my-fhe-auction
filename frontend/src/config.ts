// frontend/src/config.ts
export const CHAIN_ID = 11155111;

// hai địa chỉ bạn vừa deploy
export const AUCTIONS = [
  "0x493cCee58Db9158cB3689a1c3a09E2726837aFfD",
  "0xee4743dF4789Af428421e56Aa9664bB3543244f7",
];

// (tuỳ chọn) metadata hiển thị đẹp
export const AUCTION_META = {
  "0x493cCee58Db9158cB3689a1c3a09E2726837aFfD": {
    title: "Rare NFT #1",
    image: "https://telos.vn/wp-content/uploads/2022/08/binance-san-giao-dich-tien-dien-tu-lon-nhat-the-gioi-hien-da-mo-tinh-nang-nft-design.jpg",
    description: "Mô tả ngắn gọn NFT #1…",
  },
  "0xee4743dF4789Af428421e56Aa9664bB3543244f7": {
    title: "Rare NFT #2",
    image: "https://telos.vn/wp-content/uploads/2022/08/binance-san-giao-dich-tien-dien-tu-lon-nhat-the-gioi-hien-da-mo-tinh-nang-nft-design.jpg",
    description: "Mô tả ngắn gọn NFT #2…",
  },
} as const;
