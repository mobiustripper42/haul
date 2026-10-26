// Only src/adapters/pg-connect.ts may import pg (DEC-001): it applies TLS to every connection,
// so no caller can forget it. The ban covers every file lint reaches, type-only imports included.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: root });

const ruleIds = async (code, filePath) => {
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath) });
  return result.messages.map((m) => m.ruleId);
};

const VALUE_IMPORTS = [
  'import pg from "pg";',
  'import { Pool } from "pg";',
  'import Client from "pg/lib/client.js";',
  'import Pool from "pg-pool";',
  'import { parse } from "pg-connection-string";',
];
const TYPE_IMPORTS = ['import type { PoolConfig } from "pg";', 'import type { ClientConfig } from "pg/lib/index.js";'];

// One probe per kind of linted file: the app, the core, an adapter beside pg-connect, the db/
// scripts, a colocated test, a db/ test, the repo-tooling tests and the root configs.
const TS_FILES = [
  "app/pg-probe.ts",
  "src/pg-probe.ts",
  "src/adapters/pg-probe.ts",
  "src/adapters/pg-probe.test.ts",
  "db/pg-probe.ts",
  "db/pg-probe.test.ts",
  "pg-probe.config.ts",
];
const JS_FILES = ["scripts/pg-probe.test.mjs", "pg-probe.config.mjs"];

const cases = [
  ...TS_FILES.flatMap((file) => [...VALUE_IMPORTS, ...TYPE_IMPORTS].map((line) => [file, line])),
  ...JS_FILES.flatMap((file) => VALUE_IMPORTS.map((line) => [file, line])),
];

describe("AC4 — lint bans pg everywhere but pg-connect.ts", () => {
  it.each(cases)("AC4: %s fails no-restricted-imports on %s", async (file, line) => {
    expect(await ruleIds(`${line}\nexport {};\n`, file)).toContain("no-restricted-imports");
  });

  it.each([...VALUE_IMPORTS, ...TYPE_IMPORTS])("AC4: src/adapters/pg-connect.ts may import: %s", async (line) => {
    expect(await ruleIds(`${line}\nexport {};\n`, "src/adapters/pg-connect.ts")).not.toContain(
      "no-restricted-imports",
    );
  });

  it.each([
    ["src/adapters/pg-probe.ts", 'import { createPool } from "./pg-connect.js";'],
    ["db/pg-probe.ts", 'import { createClient } from "../src/adapters/pg-connect.js";'],
    ["app/pg-probe.ts", 'import { createPool } from "@core/adapters/pg-connect.js";'],
  ])("AC4: %s may import pg-connect itself: %s", async (file, line) => {
    expect(await ruleIds(`${line}\nexport {};\n`, file)).not.toContain("no-restricted-imports");
  });
});

describe("AC4 — src/ keeps the framework ban alongside the pg ban", () => {
  // In flat config a later block's options for one rule replace an earlier block's, so a pg
  // block that wins over the framework block would silently reopen src/ to Next and React.
  it.each(["src/pg-probe.ts", "src/adapters/pg-probe.ts", "src/adapters/pg-connect.ts"])(
    "AC4: %s still fails no-restricted-imports on a React import",
    async (file) => {
      expect(await ruleIds('import { useState } from "react";\nexport {};\n', file)).toContain(
        "no-restricted-imports",
      );
    },
  );
});
