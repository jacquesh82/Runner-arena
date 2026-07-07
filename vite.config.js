import { defineConfig } from "vite";

// Base relative pour que les assets se chargent aussi bien dans le WebView
// natif (Capacitor) qu'en preview web.
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "0.2.0"),
    __BUILD_NUMBER__: JSON.stringify(process.env.BUILD_NUMBER || "dev"),
    __BUILD_PLATFORM__: JSON.stringify(process.env.BUILD_PLATFORM || "WebGL"),
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
  server: { host: true, port: 5173 },
});
