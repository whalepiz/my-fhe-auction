// frontend/src/config.ts

/** Chain: Sepolia */
export const CHAIN_ID = 11155111 as const;

/**
 * Nguồn danh sách địa chỉ auctions:
 * 1) Biến môi trường VERCEL/Local: VITE_AUCTIONS="0xabc...,0xdef...,0x123..."
 * 2) Nếu không set biến môi trường, dùng mảng AUCTIONS dưới đây.
 *
 * => Nhờ vậy mỗi lần deploy Vercel cũng KHÔNG mất danh sách.
 */

function parseEnvAuctions(): string[] {
  const raw = (import.meta as any)?.env?.VITE_AUCTIONS ?? "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));
}

/** 👉👉 Hãy điền các địa chỉ auction của bạn vào mảng này (nếu chưa dùng env). */
export const AUCTIONS: string[] = (() => {
  const fromEnv = parseEnvAuctions();
  if (fromEnv.length) return fromEnv;

  // DỰ PHÒNG: điền sẵn những địa chỉ bạn muốn hiển thị mặc định
  return [
    // Ví dụ:
    // "0x556111cc5B8Bce0000000000000000000000000",
    // "0xc343AD8741E9395b46165479388C6c81D63b2b44",
  ];
})();

/** (Tuỳ chọn) Metadata hiển thị đẹp cho từng auction */
export const AUCTION_META = {
  // "0x556111cc5B8Bce0000000000000000000000000": {
  //   title: "Test",
  //   image: "https://picsum.photos/seed/test/300/180",
  //   description: "Demo FHE auction",
  // },
} as const;
