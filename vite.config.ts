import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      // .appbar-identity -> styles.appbarIdentity (and styles['appbar-identity'])
      localsConvention: "camelCase",
    },
  },
  test: {
    // 200k invariant cases need headroom on slower CI runners
    testTimeout: 120_000,
  },
});
