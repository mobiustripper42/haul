// Test-only: reading a screen rendered through react-dom/server (no DOM library is installed),
// catching a mocked `redirect`, and reading what was logged. Nothing that ships imports this.
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";

const decode = (s: string): string =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** React appends a form-replay <script> after a form whose action is a function; it is not the screen. */
const withoutScripts = (html: string): string => html.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");

/** The markup without React's script, entities decoded, for matching structure and wording. */
export function screenMarkup(html: string): string {
  return decode(withoutScripts(html));
}

/** Every run of visible text, in document order, trimmed. */
export function textsOf(html: string): string[] {
  return withoutScripts(html)
    .split(/<[^>]*>/)
    .map((text) => decode(text).trim())
    .filter((text) => text !== "");
}

/** The text of each `role="alert"` element, in document order: which notices a screen shows. */
export function alertTexts(html: string): string[] {
  return [...withoutScripts(html).matchAll(/<(\w+)\b[^>]*\brole="alert"[^>]*>([\s\S]*?)<\/\1>/g)].map((match) =>
    textsOf(match[2] ?? "").join(" "),
  );
}

/**
 * Of `wanted`, the texts the screen shows, in the order it shows them, so a test can say "A comes
 * before B" without naming everything else on the page: `expect(inOrder(html, [a, b])).toEqual([a, b])`.
 */
export function inOrder(html: string, wanted: readonly string[]): string[] {
  return textsOf(html).filter((text) => wanted.includes(text));
}

/** The attributes of every `<tag>` in document order, names lowercased, values decoded. */
export function attributesOf(html: string, tag: string): Array<Record<string, string>> {
  const found: Array<Record<string, string>> = [];
  for (const match of withoutScripts(html).matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, "g"))) {
    const attributes: Record<string, string> = {};
    for (const attr of (match[1] ?? "").matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) {
      attributes[(attr[1] ?? "").toLowerCase()] = decode(attr[2] ?? "");
    }
    found.push(attributes);
  }
  return found;
}

/**
 * The markup with React's script and comments removed and each tag's attributes sorted by name, so
 * two renderings compare equal whatever order React wrote the attributes in. Values are kept as
 * written (entities and all). `drop` names attributes to leave out of a tag, given its name and
 * attributes.
 */
export function normalMarkup(
  html: string,
  drop: (tag: string, attributes: Record<string, string>) => string[] = () => [],
): string {
  return withoutScripts(html).replace(/<([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g, (_whole, tag: string, rest: string, close: string) => {
    const attributes: Record<string, string> = {};
    for (const attr of rest.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) attributes[attr[1] ?? ""] = attr[2] ?? "";
    const dropped = new Set(drop(tag, attributes));
    const kept = Object.keys(attributes)
      .filter((name) => !dropped.has(name))
      .sort()
      .map((name) => ` ${name}="${attributes[name] ?? ""}"`);
    return `<${tag}${kept.join("")}${close}>`;
  });
}

/** Every element of `type` — a tag name or a component — in the tree a page returns, in document order. */
export function findAll(node: ReactNode, type: string | ComponentType<never>): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child as ReactNode, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  const here = node.type === type ? [node] : [];
  return [...here, ...findAll(node.props.children as ReactNode, type)];
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A `class` attribute's tokens, plus what each one's rules in app/globals.css apply, so a test can ask
 * for a look (`text-danger`) without caring whether a component writes the utility or names a class.
 * A class in a selector list (`.card, .card-fill { … }`) gets that rule too.
 */
export function utilitiesOf(classAttribute: string | undefined): string[] {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return (classAttribute ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((name) => [
      name,
      ...[...css.matchAll(new RegExp(`\\.${escapeRegExp(name)}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, "g"))].flatMap((rule) =>
        (rule[1] ?? "").split(/[\s;]+/).filter(Boolean),
      ),
    ]);
}

const BLOCK_TAGS = new Set(["p", "div", "section", "fieldset", "form", "ul", "ol", "table", "h1", "h2", "h3", "h4", "h5", "h6", "main", "header"]);
const VOID_TAGS = new Set(["input", "br", "hr", "img", "meta", "link"]);

/**
 * Every block element written inside a `<p>`. A browser closes the `<p>` at the first one, so the
 * markup it builds is not the markup the server sent. `Field` is a `<p>`, so this is what a line
 * rendered inside one must not be.
 */
export function blocksInsideParagraphs(html: string): string[] {
  const open: string[] = [];
  const found: string[] = [];
  for (const match of withoutScripts(html).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const [, closing, tag = "", selfClosed] = match;
    if (closing) {
      open.splice(open.lastIndexOf(tag), 1);
    } else if (!selfClosed && !VOID_TAGS.has(tag)) {
      if (BLOCK_TAGS.has(tag) && open.includes("p")) found.push(tag);
      open.push(tag);
    }
  }
  return found;
}

/**
 * The URL a mocked `redirect` was called with. Each test file mocks `next/navigation` so that
 * `redirect(url)` throws an error carrying `redirectTo`, as the real one throws to end the action.
 */
export async function redirectOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (e) {
    const url = (e as { redirectTo?: unknown } | null)?.redirectTo;
    if (typeof url === "string") return url;
    throw e;
  }
  throw new Error("expected a redirect, but it returned normally");
}

/** The redirect `next/navigation` is mocked with in these tests. */
export function throwingRedirect(url: string): never {
  throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { redirectTo: url });
}

/** Everything passed to a console spy, as one string — objects inspected deeply, errors included. */
export function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .map((args) => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 8 }))).join(" "))
    .join("\n");
}
