// Issue 54, AC24: env.example names the two Square sandbox variables, each empty, each under its own
// comment saying `npm run test:square` reads it and the app never does.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lines = readFileSync(new URL("./env.example", import.meta.url), "utf8").split(/\r?\n/);

describe("AC24 (issue 54) — env.example names the Square sandbox variables", () => {
  it.each(["SQUARE_SANDBOX_ACCESS_TOKEN", "SQUARE_SANDBOX_LOCATION_ID"])(
    "AC24: %s= appears once, empty, under its own comment naming npm run test:square and never read by the app",
    (name) => {
      const at = lines.flatMap((line, index) => (line.startsWith(`${name}=`) ? [index] : []));
      expect(at).toHaveLength(1);
      const index = at[0] ?? -1;
      expect(lines[index]?.trimEnd()).toBe(`${name}=`);
      const comment = lines[index - 1] ?? "";
      expect(comment.startsWith("#")).toBe(true);
      expect(comment).toContain("npm run test:square");
      expect(comment).toContain("never read by the app");
    },
  );
});
