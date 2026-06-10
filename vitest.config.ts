import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "json"],
      include: ["src/**"],
      exclude: ["src/**/__tests__/**", "src/test/**", "src/**/*.test.{ts,tsx}"],
    },
  },
});
