// Test-only: reading a screen rendered through react-dom/server (no DOM library is installed),
// catching a mocked `redirect`, and reading what was logged. Nothing that ships imports this.
import { inspect } from "node:util";
import { isValidElement, type ReactElement, type ReactNode } from "react";

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

/** Every host element of `type` in the tree a page returns, in document order. */
export function findAll(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child as ReactNode, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  const here = node.type === type ? [node] : [];
  return [...here, ...findAll(node.props.children as ReactNode, type)];
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
