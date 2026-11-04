// Issue 71, AC15: DEC-028 supersedes DEC-025, and DEC-025 says so. `npm run check:decisions`,
// in verify, checks the rest of both records' shape.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const DECISIONS = fileURLToPath(new URL("./docs/decisions/", import.meta.url));
const DEC_028 = `${DECISIONS}DEC-028-every-event-in-the-audit-log.md`;
const DEC_025 = `${DECISIONS}DEC-025-sign-in-events-in-the-audit-log.md`;

/** A record's YAML frontmatter, between its opening and closing `---` lines. */
const frontmatter = (path: string): Record<string, unknown> => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(readFileSync(path, "utf8"));
  if (!match?.[1]) throw new Error(`${path} has no frontmatter`);
  return load(match[1]) as Record<string, unknown>;
};

describe("AC15 — DEC-028 supersedes DEC-025", () => {
  it("AC15: docs/decisions/DEC-028-every-event-in-the-audit-log.md exists and its frontmatter carries supersedes: [DEC-025]", () => {
    expect(existsSync(DEC_028)).toBe(true);
    expect(frontmatter(DEC_028)).toMatchObject({ id: "DEC-028", supersedes: ["DEC-025"] });
  });

  it("AC15: DEC-025's frontmatter carries status: superseded", () => {
    expect(frontmatter(DEC_025)).toMatchObject({ id: "DEC-025", status: "superseded" });
  });
});
