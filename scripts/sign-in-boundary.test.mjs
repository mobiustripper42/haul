// Issue 9, AC39: src/sign-in/ is built to be lifted into a shared library, so lint keeps it from
// importing anything of haul's. A file there may import only another file in src/sign-in/ or a
// node: built-in; store-contract.ts and the folder's *.test.ts may also import vitest. Proved
// through the repo's own eslint.config.mjs, as issue 7's lint criteria were.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: root });

async function lint(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath) });
  return result;
}

const describeMessages = (result) =>
  JSON.stringify(result.messages.map((m) => ({ rule: m.ruleId, message: m.message })));

// Each probe is a whole module that exports what it imports, so no other rule has anything to say.
const probe = (line) => `${line}\nexport { x };\n`;

const SOURCE = "src/sign-in/probe.ts";
const TEST = "src/sign-in/probe.test.ts";
const CONTRACT = "src/sign-in/store-contract.ts";

const outside = [
  'import { normalizeEmail as x } from "../members.js";',
  'import type { Member as x } from "../members.js";',
  'import { createTranslator as x } from "../i18n.js";',
  'import x from "pg";',
  'import { FakeEmail as x } from "../adapters/fake-email.js";',
  'import type { EmailPort as x } from "../ports/email.js";',
  'import { InMemoryRepository as x } from "../adapters/in-memory-repository.js";',
  'import { after as x } from "next/server";',
  'import { useState as x } from "react";',
  'import x from "js-yaml";',
];

describe("AC39 (issue 9) — lint fails when src/sign-in/ imports outside itself", () => {
  describe.each([SOURCE, TEST, CONTRACT])("in %s", (file) => {
    it.each(outside)("AC39: fails on %s", async (line) => {
      const result = await lint(probe(line), file);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(result.errorCount, describeMessages(result)).toBeGreaterThan(0);
    });
  });

  it.each(["src/sign-in/code.ts", "src/sign-in/session.ts", "src/sign-in/memory-store.ts"])(
    "AC39: vitest is refused in %s, which is neither the store contract nor a test",
    async (file) => {
      const result = await lint(probe('import { expect as x } from "vitest";'), file);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(result.errorCount, describeMessages(result)).toBeGreaterThan(0);
    },
  );
});

describe("AC39 (issue 9) — lint passes on what src/sign-in/ may import", () => {
  const inside = [
    'import { hashCode as x } from "./code.js";',
    'import type { SignInStore as x } from "./store.js";',
    'import { createHash as x } from "node:crypto";',
    'import { isIP as x } from "node:net";',
  ];

  describe.each([SOURCE, TEST, CONTRACT])("in %s", (file) => {
    it.each(inside)("AC39: passes on %s", async (line) => {
      const result = await lint(probe(line), file);
      expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
      expect(result.errorCount, describeMessages(result)).toBe(0);
    });
  });

  it.each([TEST, CONTRACT])("AC39: %s may import vitest", async (file) => {
    const result = await lint(probe('import { expect as x } from "vitest";'), file);
    expect(result.fatalErrorCount, describeMessages(result)).toBe(0);
    expect(result.errorCount, describeMessages(result)).toBe(0);
  });
});

describe("AC39 (issue 9) — the folder as built", () => {
  it("AC39: every file in src/sign-in/ lints clean", async () => {
    const results = await eslint.lintFiles([join(root, "src/sign-in/**/*.ts")]);
    expect(results.length).toBeGreaterThan(0);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}: ${m.ruleId} ${m.message}`),
    );
    expect(errors).toEqual([]);
  });
});
