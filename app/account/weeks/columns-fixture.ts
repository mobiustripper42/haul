// Test-only: issue 243's Upcoming weeks page as markup, read by its two columns, Upcoming and then History. Nothing that
// ships imports this.
import { expect } from "vitest";

/** Where the History column starts: the element with the id the menu's History link goes to. */
const HISTORY = /<\w+\b[^>]*\sid="history"/;

/** The page's markup before the History column: the header and the Upcoming column. */
export function upcomingColumn(html: string): string {
  const at = html.search(HISTORY);
  return at === -1 ? html : html.slice(0, at);
}

/** The page's markup from the History column on. */
export function historyColumn(html: string): string {
  const at = html.search(HISTORY);
  expect(at, "the page has no element with the id history").toBeGreaterThan(-1);
  return html.slice(at);
}

/** The markup inside each list item that is in no other one: a week's row, the dishes listed inside it among what it holds. */
export function listItems(html: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (const tag of html.matchAll(/<(\/?)li\b[^>]*>/g)) {
    if (tag[1] === "") {
      if (depth === 0) start = tag.index + tag[0].length;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) items.push(html.slice(start, tag.index));
    }
  }
  return items;
}
