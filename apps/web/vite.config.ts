import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/*
 * Two pages: the panel (index.html) and the old MD3 pages kept under /legacy until the staff and admin
 * pages are redesigned. Each has its own stylesheet, so the two themes never meet in one document.
 * In dev and preview, any /legacy path is answered with legacy.html; the panel's own paths fall back
 * to index.html as usual.
 */
function legacyFallback(): Plugin {
  const rewrite = (req: { url?: string; headers: { accept?: string } }) => {
    if (req.url && /^\/legacy(\/|$|\?)/.test(req.url) && req.headers.accept?.includes("text/html")) req.url = "/legacy.html";
  };
  return {
    name: "legacy-fallback",
    configureServer: (s) => void s.middlewares.use((req, _res, next) => (rewrite(req), next())),
    configurePreviewServer: (s) => void s.middlewares.use((req, _res, next) => (rewrite(req), next())),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), legacyFallback()],
  resolve: { alias: { "@": here("./src") } },
  build: { rollupOptions: { input: { main: here("./index.html"), legacy: here("./legacy.html") } } },
  /* The panel server (apps/server) answers /api; run it with `pnpm dev:server`. */
  server: { proxy: { "/api": "http://localhost:3000" } },
});
