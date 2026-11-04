/**
 * The audit entry-point check (DEC-028). Every server action and route handler is declared in one
 * list with the event kinds it records, or a reason it records none, and this fails on an undeclared
 * entry, a stale one, an unclaimed kind, a claimed kind no test names, and a directive that is not at
 * the top of its file. Pure: the caller reads the files. Every source rule is read with the
 * TypeScript parser, never a regular expression.
 */
import ts from "typescript";
import type { AuditEventKind } from "./ports/repository.js";

/** Every server action and route handler, keyed `path#export`: the events it records, or why none. */
export type AuditEntryPoints = Record<string, { records: AuditEventKind[] } | { none: string }>;

export type Finding = {
  kind: "undeclared" | "stale" | "unclaimed-kind" | "untested-kind" | "inline-use-server";
  name: string;
};

const USE_SERVER = "use server";
const HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const isTestFile = (path: string): boolean => /\.test\.tsx?$/.test(path);
const isRouteFile = (path: string): boolean => /^app\/(?:.*\/)?route\.ts$/.test(path);

const parse = (path: string, source: string): ts.SourceFile =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Calls `visit` on `node` and every node under it. */
function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** A directive prologue is the run of string-literal statements that opens a file or a function body. */
function prologueHasUseServer(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === USE_SERVER) return true;
  }
  return false;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

/** The names a binding introduces: one identifier, or those inside a destructuring pattern. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

/** `export async function`, `export function`, `export const x =`, `export { x }`; never a type. */
function exportedNames(file: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) names.push("default");
      else if (statement.name) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) names.push(...bindingNames(declaration.name));
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) if (!element.isTypeOnly) names.push(element.name.text);
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      names.push("default");
    }
  }
  return names;
}

/** Whether `node` is a function-like with a block body whose directive prologue holds "use server". */
function hasInlineUseServer(node: ts.Node): boolean {
  const body =
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
      ? node.body
      : undefined;
  return body !== undefined && ts.isBlock(body) && prologueHasUseServer(body.statements);
}

/**
 * The one home for the source rules. `exports` is the counted exports of a "use server" file, or the
 * HTTP-method exports of an `app/**\/route.ts`, otherwise none; `useServerFile` says the file's own
 * directive prologue holds "use server"; `inlineUseServer` says a function body's does. A test file
 * is none of these.
 */
export function parseEntrySource(
  path: string,
  source: string,
): { exports: string[]; useServerFile: boolean; inlineUseServer: boolean } {
  if (isTestFile(path)) return { exports: [], useServerFile: false, inlineUseServer: false };
  const file = parse(path, source);
  const useServerFile = prologueHasUseServer(file.statements);
  let inlineUseServer = false;
  walk(file, (node) => {
    if (hasInlineUseServer(node)) inlineUseServer = true;
  });

  let exports: string[] = [];
  if (useServerFile) exports = exportedNames(file);
  else if (isRouteFile(path)) exports = exportedNames(file).filter((name) => HTTP_METHODS.has(name));
  return { exports, useServerFile, inlineUseServer };
}

/** What a test file shows the check: whether it calls `.events()`, and every string literal in it. */
function testFileFacts(path: string, source: string): { callsEvents: boolean; strings: Set<string> } {
  let callsEvents = false;
  const strings = new Set<string>();
  walk(parse(path, source), (node) => {
    if (ts.isStringLiteral(node)) strings.add(node.text);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "events") {
      callsEvents = true;
    }
  });
  return { callsEvents, strings };
}

/** The source's sibling test: `app/sign-in/actions.ts` is tested by `app/sign-in/actions.test.ts`. */
function siblingTest(path: string, sources: Record<string, string>): string | undefined {
  const base = path.replace(/\.tsx?$/, "");
  return [`${base}.test.ts`, `${base}.test.tsx`].find((candidate) => candidate in sources);
}

export function checkAuditEntryPoints(input: {
  entries: AuditEntryPoints;
  kinds: readonly AuditEventKind[];
  sources: Record<string, string>;
}): Finding[] {
  const findings: Finding[] = [];

  const exportsByFile = new Map<string, Set<string>>();
  for (const [path, source] of Object.entries(input.sources)) {
    if (isTestFile(path)) continue;
    const parsed = parseEntrySource(path, source);
    exportsByFile.set(path, new Set(parsed.exports));
    if (parsed.inlineUseServer) findings.push({ kind: "inline-use-server", name: path });
    for (const name of parsed.exports) {
      if (!(`${path}#${name}` in input.entries)) findings.push({ kind: "undeclared", name: `${path}#${name}` });
    }
  }

  const claimed = new Set<AuditEventKind>();
  const testFacts = new Map<string, ReturnType<typeof testFileFacts> | undefined>();
  for (const [key, entry] of Object.entries(input.entries)) {
    const at = key.indexOf("#");
    const path = key.slice(0, at);
    if (!exportsByFile.get(path)?.has(key.slice(at + 1))) {
      findings.push({ kind: "stale", name: key });
      if ("records" in entry) for (const kind of entry.records) claimed.add(kind);
      continue;
    }
    if (!("records" in entry)) continue;

    const testPath = siblingTest(path, input.sources);
    if (testPath !== undefined && !testFacts.has(testPath)) testFacts.set(testPath, testFileFacts(testPath, input.sources[testPath] ?? ""));
    const facts = testPath === undefined ? undefined : testFacts.get(testPath);
    for (const kind of entry.records) {
      claimed.add(kind);
      if (!facts?.callsEvents || !facts.strings.has(kind)) findings.push({ kind: "untested-kind", name: `${key}:${kind}` });
    }
  }

  for (const kind of input.kinds) if (!claimed.has(kind)) findings.push({ kind: "unclaimed-kind", name: kind });
  return findings;
}
