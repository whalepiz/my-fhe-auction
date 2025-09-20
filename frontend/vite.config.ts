// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Polyfill 'global' cho một số lib phụ thuộc (tránh màn hình đen)
export default defineConfig({
  plugins: [react()],
  define: {
    global: "window",
    "process.env": {},
  },
  optimizeDeps: {
    include: ["@fhevm/sdk"],
  },
});
