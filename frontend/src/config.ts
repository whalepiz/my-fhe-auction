// frontend/src/config.ts

// 1) Chain (mặc định Sepolia 11155111)
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

// 2) Danh sách địa chỉ auction lấy từ env
function parseAddresses(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
}

const envList = parseAddresses(import.meta.env.VITE_AUCTIONS as any);
const single = (import.meta.env.VITE_AUCTION_ADDRESS as string | undefined)?.trim();

export const AUCTIONS: string[] = envList.length ? envList : (single ? [single] : []);

// 3) (Tùy chọn) Metadata hiển thị cho từng auction
//    Có thể dùng link ảnh bất kỳ (CDN, IPFS gateway...), để trống cũng được.
export const AUCTION_META = {
  "0x493cCee58Db9158cB3689a1c3a09E2726837aFfD": {
    title: "Rare NFT #1",
    image: "https://telos.vn/wp-content/uploads/2022/08/moi-nft-la-su-doc-nhat-va-khong-ai-co-the-sao-chep-hay-an-cap-nft-do-ban-tao-ra.jpg",         // đổi thành link ảnh thật
    description: "Mô tả ngắn gọn cho NFT #1",
  },
  "0xee4743dF4789Af428421e56Aa9664bB3543244f7": {
    title: "Rare NFT #2",
    image: "https://telos.vn/wp-content/uploads/2022/08/binance-san-giao-dich-tien-dien-tu-lon-nhat-the-gioi-hien-da-mo-tinh-nang-nft-design.jpg",         // đổi thành link ảnh thật
    description: "Mô tả ngắn gọn cho NFT #2",
  },
} as const;
