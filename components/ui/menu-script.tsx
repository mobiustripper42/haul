"use client";

import { useEffect } from "react";

/**
 * What the signed-in header's menus cannot do in CSS (issue 159), as enhancement over `<details>`: with this
 * script off the drawer still opens and closes on its summary and every link and Sign out still work (the model is
 * muster's crew menu, `crew-menu-modal.tsx`).
 *
 * - The drawer: Escape closes it, a tap on the dimmed page closes it (the backdrop is the `<details>`'s own
 *   `::before`, so the tap lands on the details itself), and the rest of the page is made `inert` while it is open,
 *   since the backdrop blocks the pointer and not the keyboard. Inerting is per sibling along the path from the
 *   drawer up, because `inert` cannot be lifted from a subtree once an ancestor sets it.
 * - The Admin group: an outside click or Escape closes it.
 * - A drawer left open when the window grows to 1024px, where it is not drawn, is closed: the page would stay inert.
 *
 * Renders nothing.
 */
export function MenuScript() {
  useEffect(() => {
    const drawer = document.querySelector<HTMLDetailsElement>("details[data-menu-drawer]");
    const groups = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-menu-group]"));
    const panel = drawer?.querySelector<HTMLElement>("[data-menu-drawer-panel]");
    const summary = drawer?.querySelector<HTMLElement>("summary");
    const inerted: HTMLElement[] = [];

    /** Every element the drawer is layered over: the siblings of each element on the path from it up to `<body>`. */
    const behind = (): HTMLElement[] => {
      const found: HTMLElement[] = [];
      for (let node: HTMLElement | null = drawer ?? null; node && node !== document.body; node = node.parentElement) {
        for (const sibling of Array.from(node.parentElement?.children ?? [])) {
          if (sibling instanceof HTMLElement && sibling !== node) found.push(sibling);
        }
      }
      return found;
    };
    const sync = () => {
      for (const el of inerted.splice(0)) el.inert = false;
      if (!drawer?.open) return;
      for (const el of behind()) {
        if (el.inert) continue;
        el.inert = true;
        inerted.push(el);
      }
    };
    const closeDrawer = (returnFocus: boolean) => {
      if (!drawer) return;
      drawer.open = false;
      sync();
      // Collapsing the panel destroys the link the keyboard was on, so focus would fall to <body>.
      if (returnFocus) summary?.focus();
    };
    const closeGroups = (except?: Node | null, returnFocus = false) => {
      for (const group of groups) {
        if (!group.open || (except && group.contains(except))) continue;
        group.open = false;
        if (returnFocus) group.querySelector<HTMLElement>("summary")?.focus();
      }
    };

    const onToggle = () => {
      sync();
      // Into the panel on open, so the next Tab walks the menu rather than a page that is now inert.
      if (drawer?.open) panel?.querySelector<HTMLElement>("a, button")?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawer?.open) closeDrawer(true);
      closeGroups(null, true);
    };
    const onClick = (e: MouseEvent) => {
      // A tap on the dimmed page hit-tests as the details itself; the summary and the panel are the browser's own.
      if (drawer?.open && e.target === drawer) closeDrawer(true);
      closeGroups(e.target as Node | null);
    };
    const wide = window.matchMedia("(min-width: 64rem)");
    const onWide = () => {
      if (wide.matches) closeDrawer(false);
    };

    drawer?.addEventListener("toggle", onToggle);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    wide.addEventListener("change", onWide);
    sync();
    return () => {
      drawer?.removeEventListener("toggle", onToggle);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      wide.removeEventListener("change", onWide);
      for (const el of inerted.splice(0)) el.inert = false;
    };
  }, []);

  return null;
}
