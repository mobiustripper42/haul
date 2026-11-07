/** A legal document, block by block: what the Terms and Privacy pages draw. */
export type LegalBlock = { kind: "heading"; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/** Where the two pages live. Here and not in `app/`, because the core sends the emails that link to them. */
export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";

const HEADING = "## ";
const BULLET = "- ";

/**
 * A document's text as blocks. A line starting `## ` is a heading, a line starting `- ` is a bullet, anything
 * else is a paragraph. Consecutive bullets are one list, and blank lines separate blocks and are not blocks.
 */
export function parseLegalDocument(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let list: string[] | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      list = null;
    } else if (line.startsWith(BULLET)) {
      if (list === null) {
        list = [];
        blocks.push({ kind: "list", items: list });
      }
      list.push(line.slice(BULLET.length));
    } else {
      list = null;
      blocks.push(
        line.startsWith(HEADING) ? { kind: "heading", text: line.slice(HEADING.length) } : { kind: "paragraph", text: line },
      );
    }
  }
  return blocks;
}
