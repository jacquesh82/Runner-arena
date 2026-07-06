import { defineConfig } from "vite";

// Base relative pour que les assets se chargent aussi bien dans le WebView
// natif (Capacitor) qu'en preview web.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
  },
  server: { host: true, port: 5173 },
});
