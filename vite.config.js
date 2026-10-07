import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base relativa: el build funciona servido desde la raíz o desde una subcarpeta (GitHub Pages)
export default defineConfig({
  plugins: [react()],
  base: "./",
});
