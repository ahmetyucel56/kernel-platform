import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api -> yerel backend: canlıdaki Vercel yönlendirmesinin karşılığı (oturum çerezi aynı siteden).
const backend = "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});
