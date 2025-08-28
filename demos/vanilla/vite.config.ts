import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  server: {
    fs: {
      // Allow importing from the monorepo package src directory
      allow: [path.resolve(__dirname, "../../")],
    },
  },
  resolve: {
    alias: {
      "@virtual-ts": path.resolve(__dirname, "../../src"),
    },
  },
});

