import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    // 200k invariant cases need headroom on slower CI runners
    testTimeout: 120_000,
  },
});
