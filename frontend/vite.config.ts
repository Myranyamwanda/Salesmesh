import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  envDir: "..",
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "happy-dom",
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
    // e2e/ holds the Playwright browser checks (npm run test:e2e).
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
