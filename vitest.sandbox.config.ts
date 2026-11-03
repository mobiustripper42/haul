import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * `npm run test:square` — the suites that call Square's real sandbox (issue 54, AC22 and AC23).
 *
 * Kept out of the default run by suffix: `vitest.config.ts` includes `*.test.ts`, and these are
 * `*.sandbox.ts`. They need the network and a sandbox token, and every run leaves customers in the
 * sandbox account, so they are run on purpose, never by `verify`.
 *
 * A spread rather than `mergeConfig`, which concatenates arrays: merged, `include` would be the whole
 * default suite plus this one.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.sandbox.ts"],
  },
});
