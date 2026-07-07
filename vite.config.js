import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// Source unique du build : version depuis package.json, numéro + plateforme
// injectables par la CI (BUILD_NUMBER / CAP_PLATFORM).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
);
const BUILD_NUMBER = process.env.BUILD_NUMBER || "dev";
const BUILD_PLATFORM = process.env.CAP_PLATFORM || "WebGL";

// Base relative pour que les assets se chargent aussi bien dans le WebView
// natif (Capacitor) qu'en preview web.
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_NUMBER__: JSON.stringify(BUILD_NUMBER),
    __BUILD_PLATFORM__: JSON.stringify(BUILD_PLATFORM),
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
  server: { host: true, port: 5173 },
});
