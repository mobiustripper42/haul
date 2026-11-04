// Issue 71, AC8–AC11 and AC16: the audit entry-point check, on fixture sources. Each test starts
// from a small repo that passes — one "use server" file whose one action records `lock`, and its
// sibling test naming that kind beside `.events()` — and changes one thing. The real repo's run is
// app/audit-entry-points.test.ts.
import { describe, expect, it } from "vitest";
import { checkAuditEntryPoints, parseEntrySource, type AuditEntryPoints, type Finding } from "./audit-entry-points-check.js";
import type { AuditEventKind } from "./ports/repository.js";

const ACTIONS = "app/things/actions.ts";
const ACTIONS_TEST = "app/things/actions.test.ts";
const ROUTE = "app/api/ping/route.ts";

const ACTION_SOURCE = `"use server";

import { lock } from "./lock";

export async function lockThing(formData: FormData): Promise<void> {
  await lock(formData);
}
`;

const ACTION_TEST_SOURCE = `import { expect, it } from "vitest";
import { lockThing } from "./actions";

it("locks", async () => {
  await lockThing(new FormData());
  expect(repo.events()).toEqual([{ kind: "lock", memberId: "m-1" }]);
});
`;

type Input = { entries: AuditEntryPoints; kinds: AuditEventKind[]; sources: Record<string, string> };

/** The passing repo, with `change` applied to a fresh copy. */
const repoWith = (change: (input: Input) => void = () => {}): Input => {
  const input: Input = {
    entries: { [`${ACTIONS}#lockThing`]: { records: ["lock"] } },
    kinds: ["lock"],
    sources: { [ACTIONS]: ACTION_SOURCE, [ACTIONS_TEST]: ACTION_TEST_SOURCE },
  };
  change(input);
  return input;
};

/** Findings in a fixed order, so a test can compare the whole list. */
const check = (input: Input): Finding[] =>
  [...checkAuditEntryPoints(input)].sort((a, b) => `${a.kind} ${a.name}`.localeCompare(`${b.kind} ${b.name}`));

const ofKind = (findings: Finding[], kind: Finding["kind"]): Finding[] => findings.filter((f) => f.kind === kind);

describe("AC8 — an export a server action or route handler could be, with no entry", () => {
  it("AC8: the fixture repo, every export declared and every kind tested, has no findings", () => {
    expect(check(repoWith())).toEqual([]);
  });

  it("AC8: an exported async function in a \"use server\" file with no entry is undeclared, named path#export", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS] = `${ACTION_SOURCE}\nexport async function unlockThing(): Promise<void> {}\n`;
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: `${ACTIONS}#unlockThing` }]);
  });

  it.each([
    ["export function", "export function unlockThing(): void {}"],
    ["export const", "export const unlockThing = async (): Promise<void> => {};"],
    ["export { x }", "async function unlockThing(): Promise<void> {}\nexport { unlockThing };"],
  ])("AC8: an undeclared %s in a \"use server\" file is undeclared", (_form, code) => {
    const input = repoWith((i) => {
      i.sources[ACTIONS] = `${ACTION_SOURCE}\n${code}\n`;
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: `${ACTIONS}#unlockThing` }]);
  });

  it("AC8: export type and export interface are not counted", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS] = `${ACTION_SOURCE}\nexport type ThingState = { locked: boolean };\nexport interface ThingForm { id: string }\n`;
    });
    expect(check(input)).toEqual([]);
  });

  it("AC8: a single-quoted 'use server' makes a \"use server\" file", () => {
    const input = repoWith((i) => {
      i.sources["app/things/more-actions.ts"] = "'use server';\n\nexport async function moreThing(): Promise<void> {}\n";
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: "app/things/more-actions.ts#moreThing" }]);
  });

  it("AC8: comments and blank lines before the directive still make a \"use server\" file", () => {
    const input = repoWith((i) => {
      i.sources["app/things/more-actions.ts"] =
        "// The things' other actions.\n/* A block comment. */\n\n\"use server\";\n\nexport async function moreThing(): Promise<void> {}\n";
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: "app/things/more-actions.ts#moreThing" }]);
  });

  it.each([
    ["only in a comment", '// "use server";\n\nexport async function helper(): Promise<void> {}\n'],
    ["only inside other code", 'const marker = "use server";\n\nexport async function helper(): Promise<string> {\n  return marker;\n}\n'],
    ["after an import, outside the directive prologue", 'import { x } from "./x";\n"use server";\n\nexport async function helper(): Promise<void> {\n  x();\n}\n'],
  ])("AC8: a file with \"use server\" %s is not a \"use server\" file — its exports are not undeclared", (_where, source) => {
    const input = repoWith((i) => {
      i.sources["app/things/helpers.ts"] = source;
    });
    expect(ofKind(check(input), "undeclared")).toEqual([]);
  });

  it("AC8: a plain module's exports are not counted", () => {
    const input = repoWith((i) => {
      i.sources["app/things/format.ts"] = "export function formatThing(): string {\n  return '';\n}\nexport const THINGS = 3;\n";
    });
    expect(check(input)).toEqual([]);
  });

  it("AC8: a .tsx \"use server\" file is scanned", () => {
    const input = repoWith((i) => {
      i.sources["app/things/form-actions.tsx"] = '"use server";\n\nexport async function submitThing(): Promise<void> {}\n';
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: "app/things/form-actions.tsx#submitThing" }]);
  });

  it("AC8: a \"use server\" file under src/ is scanned", () => {
    const input = repoWith((i) => {
      i.sources["src/things/jobs.ts"] = '"use server";\n\nexport async function runThing(): Promise<void> {}\n';
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: "src/things/jobs.ts#runThing" }]);
  });

  it.each(["app/things/more.test.ts", "app/things/more.test.tsx"])("AC8: a test file, %s, is not scanned", (path) => {
    const input = repoWith((i) => {
      i.sources[path] = '"use server";\n\nexport async function fakeThing(): Promise<void> {}\n';
    });
    expect(check(input)).toEqual([]);
  });

  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "AC8: an undeclared %s handler exported from an app/**/route.ts is undeclared",
    (method) => {
      const input = repoWith((i) => {
        i.sources[ROUTE] = `export async function ${method}(request: Request): Promise<Response> {\n  return new Response(request.url);\n}\n`;
      });
      expect(check(input)).toEqual([{ kind: "undeclared", name: `${ROUTE}#${method}` }]);
    },
  );

  it("AC8: a route handler exported as a const is counted", () => {
    const input = repoWith((i) => {
      i.sources[ROUTE] = "export const GET = (): Response => new Response(null);\n";
    });
    expect(check(input)).toEqual([{ kind: "undeclared", name: `${ROUTE}#GET` }]);
  });

  it("AC8: a route file's exports that are not HTTP methods are not counted", () => {
    const input = repoWith((i) => {
      i.sources[ROUTE] = 'export const dynamic = "force-dynamic";\nexport function ping(): string {\n  return "pong";\n}\n';
    });
    expect(check(input)).toEqual([]);
  });

  it.each([
    ["a route.tsx", "app/api/ping/route.tsx"],
    ["a route.ts outside app/", "src/api/ping/route.ts"],
    ["a file named like a route", "app/api/ping/reroute.ts"],
  ])("AC8: %s is not a route file — its GET is not counted", (_what, path) => {
    const input = repoWith((i) => {
      i.sources[path] = "export function GET(): Response {\n  return new Response(null);\n}\n";
    });
    expect(check(input)).toEqual([]);
  });

  it("AC8: a declared route handler is not undeclared", () => {
    const input = repoWith((i) => {
      i.sources[ROUTE] = "export function GET(): Response {\n  return new Response(null);\n}\n";
      i.entries[`${ROUTE}#GET`] = { none: "reads" };
    });
    expect(check(input)).toEqual([]);
  });
});

describe("AC9 — an entry whose file or export no longer exists", () => {
  it("AC9: an entry whose file is gone is one stale finding, named by the entry key", () => {
    const input = repoWith((i) => {
      i.entries["app/gone/actions.ts#goneThing"] = { none: "ends the session; writes no data" };
    });
    expect(check(input)).toEqual([{ kind: "stale", name: "app/gone/actions.ts#goneThing" }]);
  });

  it("AC9: an entry whose export is gone from a file that still exists is one stale finding, named by the entry key", () => {
    const input = repoWith((i) => {
      i.entries[`${ACTIONS}#renamedThing`] = { none: "sets a cookie only" };
    });
    expect(check(input)).toEqual([{ kind: "stale", name: `${ACTIONS}#renamedThing` }]);
  });

  it("AC9: a route entry for a method the route no longer exports is stale", () => {
    const input = repoWith((i) => {
      i.sources[ROUTE] = "export function POST(): Response {\n  return new Response(null);\n}\n";
      i.entries[`${ROUTE}#POST`] = { none: "dev only; reads" };
      i.entries[`${ROUTE}#GET`] = { none: "dev only; reads" };
    });
    expect(check(input)).toEqual([{ kind: "stale", name: `${ROUTE}#GET` }]);
  });

  it("AC9: an entry that claims a kind and whose export is gone gives one stale finding", () => {
    const input = repoWith((i) => {
      i.entries[`${ACTIONS}#renamedThing`] = { records: ["lock"] };
    });
    expect(ofKind(check(input), "stale")).toEqual([{ kind: "stale", name: `${ACTIONS}#renamedThing` }]);
  });
});

describe("AC10 — a kind no entry claims", () => {
  it("AC10: a kind in the list that no entry's records claims is unclaimed-kind, named by the kind", () => {
    const input = repoWith((i) => {
      i.kinds = ["lock", "sign_in_by_link"];
    });
    expect(check(input)).toEqual([{ kind: "unclaimed-kind", name: "sign_in_by_link" }]);
  });

  it("AC10: every kind unclaimed when only none entries exist is reported, one finding per kind", () => {
    const input = repoWith((i) => {
      i.entries = { [`${ACTIONS}#lockThing`]: { none: "writes no data" } };
      i.kinds = ["lock", "rate_limit_refusal"];
    });
    expect(check(input)).toEqual([
      { kind: "unclaimed-kind", name: "lock" },
      { kind: "unclaimed-kind", name: "rate_limit_refusal" },
    ]);
  });
});

describe("AC11 — a claimed kind whose sibling test file does not call .events() and name it", () => {
  it("AC11: a test file that names the kind but never calls .events() gives untested-kind, named path#export:kind", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS_TEST] = 'it("locks", async () => {\n  expect(await lockThing()).toEqual({ kind: "lock" });\n});\n';
    });
    expect(check(input)).toEqual([{ kind: "untested-kind", name: `${ACTIONS}#lockThing:lock` }]);
  });

  it("AC11: a test file that calls .events() but carries the kind only inside a longer name (lockedNow) gives untested-kind", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS_TEST] =
        'it("locks", async () => {\n  const { lockedNow } = await lockThing();\n  expect(repo.events()).toEqual([lockedNow, "unlock", "locked"]);\n});\n';
    });
    expect(check(input)).toEqual([{ kind: "untested-kind", name: `${ACTIONS}#lockThing:lock` }]);
  });

  it("AC11: the kind as a single-quoted string literal counts", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS_TEST] = "it('locks', async () => {\n  expect(repo.events()).toEqual([{ kind: 'lock' }]);\n});\n";
    });
    expect(check(input)).toEqual([]);
  });

  it("AC11: the kind built in a helper outside the expect(...) counts", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS_TEST] =
        'const lockEvent = (memberId: string) => ({ kind: "lock", memberId });\n\nit("locks", async () => {\n  expect(repo.events()).toEqual([lockEvent("m-1")]);\n});\n';
    });
    expect(check(input)).toEqual([]);
  });

  it("AC11: with no sibling test file, each claimed kind is one untested-kind", () => {
    const input = repoWith((i) => {
      i.kinds = ["lock", "sign_in_by_code"];
      i.entries[`${ACTIONS}#lockThing`] = { records: ["sign_in_by_code", "lock"] };
      delete i.sources[ACTIONS_TEST];
    });
    expect(check(input)).toEqual([
      { kind: "untested-kind", name: `${ACTIONS}#lockThing:lock` },
      { kind: "untested-kind", name: `${ACTIONS}#lockThing:sign_in_by_code` },
    ]);
  });

  it("AC11: the test file is the source's sibling — another test file that names the kind does not count", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS_TEST] = 'it("locks", async () => {\n  expect(repo.events()).toEqual([]);\n});\n';
      i.sources["app/other/actions.test.ts"] = ACTION_TEST_SOURCE;
    });
    expect(check(input)).toEqual([{ kind: "untested-kind", name: `${ACTIONS}#lockThing:lock` }]);
  });

  it("AC11: each claimed kind is checked on its own — the one the test file does not name is untested-kind", () => {
    const input = repoWith((i) => {
      i.kinds = ["lock", "sign_in_by_code"];
      i.entries[`${ACTIONS}#lockThing`] = { records: ["lock", "sign_in_by_code"] };
    });
    expect(check(input)).toEqual([{ kind: "untested-kind", name: `${ACTIONS}#lockThing:sign_in_by_code` }]);
  });

  it("AC11: the match is per test file, not per export — two actions claiming one kind pass on one mention of it", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS] = `${ACTION_SOURCE}\nexport async function relockThing(): Promise<void> {}\n`;
      i.entries[`${ACTIONS}#relockThing`] = { records: ["lock"] };
    });
    expect(check(input)).toEqual([]);
  });

  it("AC11: a none entry needs no test file", () => {
    const input = repoWith((i) => {
      i.sources["app/things/cookie-actions.ts"] = '"use server";\n\nexport async function setThing(): Promise<void> {}\n';
      i.entries["app/things/cookie-actions.ts#setThing"] = { none: "sets a cookie only" };
    });
    expect(check(input)).toEqual([]);
  });
});

describe("AC16 — a \"use server\" directive inside a function", () => {
  const HELPERS = "app/things/helpers.ts";

  it.each([
    ["a function declaration", 'export function makeAction() {\n  "use server";\n  return 1;\n}\n'],
    ["a function expression", 'export const makeAction = function () {\n  "use server";\n  return 1;\n};\n'],
    ["a block-bodied arrow", 'export const makeAction = async () => {\n  "use server";\n  return 1;\n};\n'],
    ["a class method", 'export class Things {\n  async save() {\n    "use server";\n    return 1;\n  }\n}\n'],
    ["an object method", 'export const things = {\n  async save() {\n    "use server";\n    return 1;\n  },\n};\n'],
    ["a nested function", 'export function outer() {\n  return async function inner() {\n    "use server";\n    return 1;\n  };\n}\n'],
  ])("AC16: \"use server\" in the directive prologue of %s is inline-use-server, named by the file", (_shape, source) => {
    const input = repoWith((i) => {
      i.sources[HELPERS] = source;
    });
    expect(check(input)).toEqual([{ kind: "inline-use-server", name: HELPERS }]);
  });

  it("AC16: a single-quoted inline directive, with a comment before it, is inline-use-server", () => {
    const input = repoWith((i) => {
      i.sources[HELPERS] = "export async function makeAction() {\n  // A server action, inline.\n  'use server';\n  return 1;\n}\n";
    });
    expect(check(input)).toEqual([{ kind: "inline-use-server", name: HELPERS }]);
  });

  it("AC16: an inline directive in a \"use server\" file is inline-use-server too", () => {
    const input = repoWith((i) => {
      i.sources[ACTIONS] = `${ACTION_SOURCE}\nasync function inner(): Promise<void> {\n  "use server";\n}\nvoid inner;\n`;
    });
    expect(check(input)).toEqual([{ kind: "inline-use-server", name: ACTIONS }]);
  });

  it("AC16: an inline directive in a file under src/ is inline-use-server", () => {
    const input = repoWith((i) => {
      i.sources["src/things/jobs.ts"] = 'export function makeJob() {\n  "use server";\n  return 1;\n}\n';
    });
    expect(check(input)).toEqual([{ kind: "inline-use-server", name: "src/things/jobs.ts" }]);
  });

  it.each([
    ["after another statement in the body", 'export function make() {\n  const a = 1;\n  "use server";\n  return a;\n}\n'],
    ["as a concise arrow's value", 'export const make = () => "use server";\n'],
    ["as an argument", 'export function make() {\n  return String("use server");\n}\n'],
    ["in a comment in a body", 'export function make() {\n  // "use server";\n  return 1;\n}\n'],
  ])("AC16: \"use server\" %s is not a directive — no inline-use-server", (_where, source) => {
    const input = repoWith((i) => {
      i.sources[HELPERS] = source;
    });
    expect(check(input)).toEqual([]);
  });

  it.each(["app/things/helpers.test.ts", "app/things/helpers.test.tsx"])("AC16: an inline directive in a test file, %s, is not reported", (path) => {
    const input = repoWith((i) => {
      i.sources[path] = 'it("acts", () => {\n  async function act() {\n    "use server";\n  }\n  void act;\n});\n';
    });
    expect(check(input)).toEqual([]);
  });
});

describe("AC8, AC16 — parseEntrySource, the one home for the source rules", () => {
  it("AC8: a \"use server\" file lists its counted exports and says it is one", () => {
    const parsed = parseEntrySource(
      ACTIONS,
      `${ACTION_SOURCE}\nexport function a() {}\nexport const b = 1;\nconst c = 2;\nexport { c };\nexport type D = string;\n`,
    );
    expect({ ...parsed, exports: [...parsed.exports].sort() }).toEqual({
      exports: ["a", "b", "c", "lockThing"],
      useServerFile: true,
      inlineUseServer: false,
    });
  });

  it("AC8: an app/**/route.ts lists its HTTP-method exports only", () => {
    const parsed = parseEntrySource(
      ROUTE,
      'export function GET() {}\nexport async function POST() {}\nexport const dynamic = "force-dynamic";\nexport function helper() {}\n',
    );
    expect({ ...parsed, exports: [...parsed.exports].sort() }).toEqual({
      exports: ["GET", "POST"],
      useServerFile: false,
      inlineUseServer: false,
    });
  });

  it("AC16: a function-body directive sets inlineUseServer", () => {
    expect(parseEntrySource("app/things/helpers.ts", 'export function make() {\n  "use server";\n}\n')).toEqual({
      exports: [],
      useServerFile: false,
      inlineUseServer: true,
    });
  });
});
