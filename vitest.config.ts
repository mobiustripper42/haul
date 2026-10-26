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
    include: ["src/**/*.test.ts", "app/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
