import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig.json's `paths` (`@core/* → ./src/*`), so a test can import an app/ module
      // that reaches the core.
      "@core": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Root `*.test.ts` covers the configs' own tests (playwright.config.test.ts, next.config.test.ts).
    // Nothing under e2e/: those are Playwright's (issue 31, AC9).
    include: ["*.test.ts", "src/**/*.test.ts", "app/**/*.test.ts", "db/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
