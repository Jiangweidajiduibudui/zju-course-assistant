import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// docs/07 §4.1：defineConfig + plugin-react + @tailwindcss/vite；
// /api 代理只在 vite dev 生效，生产环境由 Fastify 同源提供 API 并托管 dist/client。
export default defineConfig({
  root: "src/client",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
