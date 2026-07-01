import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // The xlsx library is lazy-loaded (dynamic import) only when attendance
    // Excel files are parsed, so its chunk size doesn't affect initial load.
    chunkSizeWarningLimit: 600,
  },
});
