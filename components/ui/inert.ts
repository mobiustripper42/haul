/** How many holders have each element switched off. An element comes back on when the last of them lets go (issue 240). */
const holds = new WeakMap<HTMLElement, number>();

/**
 * Switches `elements` off (`inert`) and returns the release. Counted per element, so the open drawer and a page that is
 * sending a form can hold the same element, and the drawer closing cannot switch back on what the send still holds.
 */
export function holdInert(elements: HTMLElement[]): () => void {
  const held = [...new Set(elements)];
  for (const el of held) {
    holds.set(el, (holds.get(el) ?? 0) + 1);
    el.inert = true;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const el of held) {
      const left = (holds.get(el) ?? 1) - 1;
      if (left > 0) {
        holds.set(el, left);
        continue;
      }
      holds.delete(el);
      el.inert = false;
    }
  };
}

/**
 * Every element layered beside the path from each of `keep` up to `<body>`: the siblings along it that are not on a path
 * themselves. `inert` cannot be lifted from a subtree once an ancestor sets it, so what is kept is kept by switching off
 * its siblings, one level at a time, and never an ancestor.
 */
export function siblingsAround(keep: Element[]): HTMLElement[] {
  const onPath = new Set<Element>();
  for (const el of keep) {
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) onPath.add(node);
  }
  const found = new Set<HTMLElement>();
  for (const node of onPath) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling instanceof HTMLElement && !onPath.has(sibling)) found.add(sibling);
    }
  }
  return [...found];
}
