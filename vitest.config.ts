import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig.json's `paths` (`@core/* → ./src/*`), so a test can import an app/ module
      // that reaches the core.
      "@core": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "app/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
