// Issue 59, AC2: every page, route and server action under app/admin/ calls `requireAdmin` first
// (DEC-018). The files are found, never listed, so a new file is covered with no edit here. Routes and
// actions come from `parseEntrySource`, pages from their file name, and "first" is read with the
// TypeScript parser, as every source rule is (src/audit-entry-points-check.ts).
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parseEntrySource, sourcesUnder } from "@core/audit-entry-points-check.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const isPage = (path: string): boolean => /(?:^|\/)page\.tsx?$/.test(path);

const functionBody = (node: ts.Node | undefined): ts.ConciseBody | undefined =>
  node && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) ? node.body : undefined;

const isExportedDefault = (statement: ts.Statement): boolean =>
  ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false);

/** The body of the function `file` holds under `name`, following `export default X` and `export { X as name }`. */
function bodyOf(file: ts.SourceFile, name: string): ts.ConciseBody | undefined {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && (statement.name?.text === name || (name === "default" && isExportedDefault(statement)))) return statement.body;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return functionBody(declaration.initializer);
      }
    }
    if (ts.isExportAssignment(statement) && name === "default") {
      return ts.isIdentifier(statement.expression) ? bodyOf(file, statement.expression.text) : functionBody(statement.expression);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === name && element.propertyName) return bodyOf(file, element.propertyName.text);
      }
    }
  }
  return undefined;
}

const isRequireAdmin = (expression: ts.Expression | undefined): boolean =>
  expression !== undefined &&
  ts.isAwaitExpression(expression) &&
  ts.isCallExpression(expression.expression) &&
  ts.isIdentifier(expression.expression.expression) &&
  expression.expression.expression.text === "requireAdmin";

/** `await requireAdmin();` or `const admin = await requireAdmin();` as the body's first statement. */
function opensWithRequireAdmin(body: ts.ConciseBody | undefined): boolean {
  if (body === undefined || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  if (first === undefined) return false;
  if (ts.isExpressionStatement(first)) return isRequireAdmin(first.expression);
  return ts.isVariableStatement(first) && first.declarationList.declarations.length === 1 && isRequireAdmin(first.declarationList.declarations[0]?.initializer);
}

/** `path#name` for each page, route handler and server action in `sources` that does not call `requireAdmin` first. */
function unguarded(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([path, source]) => {
    const names = [...parseEntrySource(path, source).exports, ...(isPage(path) ? ["default"] : [])];
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return names.filter((name) => !opensWithRequireAdmin(bodyOf(file, name))).map((name) => `${path}#${name}`);
  });
}

describe("AC2 — every entry under app/admin/ calls requireAdmin first", () => {
  it("AC2: the scan reaches the page and the spreadsheet route, so an empty result is not an empty scan", () => {
    expect(Object.keys(sourcesUnder(ROOT, "app/admin"))).toEqual(expect.arrayContaining(["app/admin/page.tsx", "app/admin/members.csv/route.ts"]));
  });

  it("AC2: every page, route and server action in app/admin/ opens with requireAdmin", () => {
    expect(unguarded(sourcesUnder(ROOT, "app/admin"))).toEqual([]);
  });
});

// What the scan above would say of a file that is not there yet: the rule, on fixtures.
describe("AC2 — a new file under app/admin/ is covered with no edit here", () => {
  const GUARDED = `const member = await requireAdmin();\n  return member.id;`;
  const LATE = `const t = await getTranslator();\n  await requireAdmin();\n  return t;`;

  it.each([
    ["a page", "app/admin/reports/page.tsx", `export default async function Reports() {\n  return null;\n}`],
    ["a page checking second", "app/admin/reports/page.tsx", `export default async function Reports() {\n  ${LATE}\n}`],
    ["a page named after its default export", "app/admin/reports/page.tsx", `async function Reports() {\n  return null;\n}\nexport default Reports;`],
    ["a page that forgets the await", "app/admin/reports/page.tsx", `export default async function Reports() {\n  requireAdmin();\n  return null;\n}`],
    ["a page that only mentions it", "app/admin/reports/page.tsx", `// await requireAdmin();\nexport default async function Reports() {\n  return "requireAdmin";\n}`],
  ])("AC2: %s with no check first is found", (_what, path, source) => {
    expect(unguarded({ [path]: source })).toEqual([`${path}#default`]);
  });

  it.each([
    ["a route", `export async function POST() {\n  return new Response("");\n}`],
    ["a route checking second", `export async function POST() {\n  ${LATE}\n}`],
    ["an arrow route", `export const POST = async () => new Response("");`],
  ])("AC2: %s with no check first is found", (_what, source) => {
    expect(unguarded({ "app/admin/new/route.ts": source })).toEqual(["app/admin/new/route.ts#POST"]);
  });

  it("AC2: each server action in a file is read on its own: the one with no check is found", () => {
    const source = `"use server";\nexport async function close() {\n  ${GUARDED}\n}\nexport async function open() {\n  return 1;\n}`;
    expect(unguarded({ "app/admin/actions.ts": source })).toEqual(["app/admin/actions.ts#open"]);
  });

  it("AC2: an action exported under another name is read through to its function", () => {
    const source = `"use server";\nasync function secret() {\n  return 1;\n}\nexport { secret as open };`;
    expect(unguarded({ "app/admin/actions.ts": source })).toEqual(["app/admin/actions.ts#open"]);
  });

  it("AC2: the check is met by either way of writing it, in a page, a route and an action", () => {
    expect(
      unguarded({
        "app/admin/reports/page.tsx": `export default async function Reports() {\n  await requireAdmin();\n  return null;\n}`,
        "app/admin/new/route.ts": `export async function GET() {\n  ${GUARDED}\n}`,
        "app/admin/actions.ts": `"use server";\nexport const close = async () => {\n  ${GUARDED}\n};`,
      }),
    ).toEqual([]);
  });

  it("AC2: a helper, a client component and a test file under app/admin/ are not entries", () => {
    expect(
      unguarded({
        "app/admin/members-list.tsx": `"use client";\nexport function MembersList() {\n  return null;\n}`,
        "app/admin/format.ts": `export const format = (s: string) => s;`,
        "app/admin/page.test.ts": `export const x = 1;`,
      }),
    ).toEqual([]);
  });
});
