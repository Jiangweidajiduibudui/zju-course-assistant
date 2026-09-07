import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  return {
    root: "src/client",
    plugins: [react(), tailwindcss()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    build: {
      outDir: fileURLToPath(
        new URL(
          mode === "fixture" ? "./dist/fixture" : "./dist/app",
          import.meta.url,
        ),
      ),
      emptyOutDir: true,
    },
  };
});
