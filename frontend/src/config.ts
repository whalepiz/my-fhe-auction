// frontend/src/config.ts

/** Chain: Sepolia */
export const CHAIN_ID = 11155111 as const;

/** RPC endpoints fallback để đọc on-chain trong trình duyệt */
export const RPCS: string[] = [
  "https://eth-sepolia.public.blastapi.io",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
  "https://ethereum-sepolia.publicnode.com",
];

/** Lấy danh sách auctions từ biến môi trường (Vercel/Local) nếu có */
function parseEnvAuctions(): string[] {
  const raw = (import.meta as any)?.env?.VITE_AUCTIONS ?? "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));
}

/** Danh sách mặc định (khi không set VITE_AUCTIONS) */
export const AUCTIONS: string[] = (() => {
  const fromEnv = parseEnvAuctions();
  if (fromEnv.length) return fromEnv;
  return [
    // điền sẵn địa chỉ nếu muốn:
    // "0x1234....",
  ];
})();

/** Metadata hiển thị (tuỳ chọn) */
export const AUCTION_META: Record<
  string,
  { title?: string; image?: string; description?: string }
> = {
  // "0x1234...": { title: "Rare NFT #1" },
};
