import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /* The panel server (apps/server) answers /api; run it with `pnpm dev:server`. */
  server: { proxy: { "/api": "http://localhost:3000" } },
});
