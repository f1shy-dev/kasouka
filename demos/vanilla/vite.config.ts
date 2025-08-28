import { defineConfig } from "vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../../")],
    },
  },
  plugins: [tailwindcss()],
});
