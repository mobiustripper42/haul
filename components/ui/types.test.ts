// Issue 38, AC9: a Button's kind, and the absence of a className on Button and Input, are held by
// TypeScript. Each fixture is typechecked under tsconfig.json's own options (the profile
// `npm run typecheck:app` runs), as scripts/core-boundary.test.mjs typechecks the core's: a
// temporary tsconfig extends it, with the fixtures in a temporary directory outside every path
// `npm run lint` reads. The directory links the repo's node_modules, so `react/jsx-runtime` and the
// components' own imports resolve to the same types.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const UI = join(ROOT, "components", "ui");

const FIXTURES: Record<string, string> = {
  "button-ok": [
    `import { Button } from ${JSON.stringify(join(UI, "button"))};`,
    "export const a = <Button kind=\"primary\" type=\"submit\" full>x</Button>;",
    "export const b = <Button kind=\"secondary\" name=\"n\" value=\"v\">x</Button>;",
    "export const c = <Button kind=\"quiet\" flush aria-current=\"true\">x</Button>;",
    "export const d = <Button kind=\"quiet\" href=\"/sign-in\" back flush>x</Button>;",
  ].join("\n"),
  "input-ok": [
    `import { Input } from ${JSON.stringify(join(UI, "input"))};`,
    'export const a = <Input id="code" name="code" inputMode="numeric" maxLength={6} required code aria-invalid />;',
  ].join("\n"),
  "button-no-kind": [
    `import { Button } from ${JSON.stringify(join(UI, "button"))};`,
    'export const a = <Button type="submit">x</Button>;',
  ].join("\n"),
  "button-unknown-kind": [
    `import { Button } from ${JSON.stringify(join(UI, "button"))};`,
    'export const a = <Button kind="danger" type="submit">x</Button>;',
  ].join("\n"),
  "button-class-name": [
    `import { Button } from ${JSON.stringify(join(UI, "button"))};`,
    'export const a = <Button kind="primary" className="w-full">x</Button>;',
  ].join("\n"),
  "button-link-class-name": [
    `import { Button } from ${JSON.stringify(join(UI, "button"))};`,
    'export const a = <Button kind="quiet" href="/sign-in" className="back-link">x</Button>;',
  ].join("\n"),
  "input-class-name": [
    `import { Input } from ${JSON.stringify(join(UI, "input"))};`,
    'export const a = <Input id="email" className="field" />;',
  ].join("\n"),
};

let errors: Record<string, string[]> = {};
let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "haul-ui-types-"));
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  for (const [name, source] of Object.entries(FIXTURES)) writeFileSync(join(dir, `${name}.tsx`), `${source}\n`);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: join(ROOT, "tsconfig.json"),
      compilerOptions: { incremental: false },
      include: [join(dir, "*.tsx")],
    }),
  );
  let output = "";
  try {
    execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", join(dir, "tsconfig.json"), "--pretty", "false"], { stdio: "pipe" });
  } catch (e) {
    output = String((e as { stdout?: unknown }).stdout ?? "") || `tsc failed with no output: ${String(e)}`;
  }
  // An error is one line naming its file, then indented lines that continue it.
  errors = {};
  let file = "(elsewhere)";
  for (const line of output.split("\n").filter(Boolean)) {
    if (!/^\s/.test(line)) file = /([\w-]+)\.tsx\(\d+,\d+\): error/.exec(line)?.[1] ?? "(elsewhere)";
    (errors[file] ??= []).push(line);
  }
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("AC9 — the components' types", () => {
  it("AC9: the fixtures' setup typechecks: every valid Button and Input passes, and nothing fails outside the fixtures", () => {
    expect(errors["button-ok"] ?? [], "a valid Button failed").toEqual([]);
    expect(errors["input-ok"] ?? [], "a valid Input failed").toEqual([]);
    expect(errors["(elsewhere)"] ?? [], "tsc failed outside the fixtures").toEqual([]);
  });

  it.each([
    ["a Button with no kind", "button-no-kind", "kind"],
    ["a Button whose kind is outside the three", "button-unknown-kind", "danger"],
    ["a Button with a className", "button-class-name", "className"],
    ["a Button with href and a className", "button-link-class-name", "className"],
    ["an Input with a className", "input-class-name", "className"],
  ])("AC9: typecheck:app's profile fails on %s", (_what, fixture, named) => {
    const found = errors[fixture] ?? [];
    expect(found, `${fixture}.tsx typechecked clean`).not.toEqual([]);
    expect(found.join("\n")).toContain(named);
  });
});
