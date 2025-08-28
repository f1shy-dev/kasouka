import { defineConfig } from "vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    fs: {
      // Allow importing from the monorepo package src directory
      allow: [path.resolve(__dirname, "../../")],
    },
  },
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@virtual-ts": path.resolve(__dirname, "../../src"),
    },
  },
});
