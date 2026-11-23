import { holdInert, siblingsAround } from "./inert";

/**
 * Switches off everything on the page except `spare` (the tapped button) and what holds them, and
 * returns the unlock. What is added to the page afterwards is never switched off, which is how Square's bank check stays
 * usable (issue 240).
 */
export function lockPage(spare: Element[]): () => void {
  return holdInert(siblingsAround(spare));
}
