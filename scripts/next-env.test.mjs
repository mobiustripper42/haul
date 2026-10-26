// next build writes next-env.d.ts; it is generated, so git neither tracks nor wants it.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

describe("AC12 — next-env.d.ts is generated, not tracked", () => {
  it("AC12: .gitignore ignores next-env.d.ts", () => {
    // --no-index, so the answer comes from .gitignore even while the file is still in the index.
    expect(git("check-ignore", "--no-index", "-q", "next-env.d.ts").status).toBe(0);
  });

  it("AC12: git no longer tracks next-env.d.ts", () => {
    const run = git("ls-files", "next-env.d.ts");
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("");
  });
});
