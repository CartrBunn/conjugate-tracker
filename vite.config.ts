import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves project sites at /<repo-name>/. Override with BASE_PATH if the repo is renamed.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/conjugate-training/",
  plugins: [react()],
  server: { port: 5180, strictPort: true }, // 5173 is used by another local project
});
