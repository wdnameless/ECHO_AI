import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        // Only `onnxruntime` is split out by hand — the microphone's VAD needs it
        // during startup, so it stays in the overlay's graph by design.
        //
        // The renderer vendors (katex, mermaid, cytoscape, shiki/highlight) must
        // NOT be listed here. A manual chunk is a hard module edge: Rollup hoists
        // it into the entry's static imports, Vite then emits a `modulepreload`
        // for it in `index.html`, and every app start downloads the lot before
        // the bar can paint. Measured with the four entries below present:
        // 13.7 MB at startup (12.6 MB of it `modulepreload`). With them removed
        // the preloads disappear and startup drops to 1.6 MB. Those libraries are
        // reached only through the lazily imported markdown renderer, so Rollup
        // already splits them correctly on its own.
        manualChunks(id) {
          if (id.includes("node_modules") && id.includes("onnxruntime")) {
            return "vendor-onnx";
          }
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
