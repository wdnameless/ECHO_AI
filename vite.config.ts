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
        // Split heavy editor/markdown deps out of the startup bundle:
        // katex, mermaid, cytoscape, highlight are only needed inside
        // rendered AI answers / dashboard pages, not the main bar.
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("katex")) return "vendor-katex";
            if (id.includes("mermaid")) return "vendor-mermaid";
            if (id.includes("cytoscape")) return "vendor-cytoscape";
            if (
              id.includes("highlight.js") ||
              id.includes("lowlight") ||
              id.includes("shiki")
            ) {
              return "vendor-highlight";
            }
            if (id.includes("onnxruntime")) return "vendor-onnx";
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
