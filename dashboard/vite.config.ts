import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base so the static build works from any path (GitHub Pages, Vercel, IPFS).
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1000, // the lazy hero scene (three.js) is ~925 KB and loads only after idle
    rollupOptions: {
      output: {
        // three.js is deliberately absent: a manual chunk would also capture small helpers the rest of the
        // app imports, which made the browser preload all of three.js on first visit. Left to the lazy
        // import of the hero scene, it is fetched only when the scene is.
        manualChunks: {
          wallet: ["@rainbow-me/rainbowkit", "wagmi"],
          chain: ["viem"],
          ui: ["motion", "sonner", "@radix-ui/react-tabs", "@radix-ui/react-tooltip"],
        },
      },
    },
  },
});
