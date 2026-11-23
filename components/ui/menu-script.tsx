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
 * - The Admin group, and a row's More (issue 220): an outside click, focus moving outside it, or Escape closes it.
 * - A link in a menu closes it at once when it opens the page already showing; a link to another page closes the menus
 *   on the first change to the page after the address has changed, since a query-only step keeps this header mounted
 *   (issue 245).
 * - A drawer left open when the window grows to 1024px, where it is not drawn, is closed: the page would stay inert.
 *
 * Renders nothing.
 */
export function MenuScript() {
  useEffect(() => {
    const drawer = document.querySelector<HTMLDetailsElement>("details[data-menu-drawer]");
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
    // Looked up at each event: a row's More is drawn anew whenever the calendar navigates, and the header mounts this once (issue 220).
    const groupsNow = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-menu-group]"));
    const closeGroups = (except?: Node | null, returnFocus = false) => {
      for (const group of groupsNow()) {
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
      closeForLinkToHere(e.target);
    };
    // A link to another page leaves its menu to the new page, which draws its own header with the menus closed (issue 245),
    // so the pending page can show its spinner inside the open menu. A link to the page already showing has no new page
    // coming, so its menu closes at once.
    const closeForLinkToHere = (target: EventTarget | null) => {
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link) return;
      const group = link.closest<HTMLDetailsElement>("details[data-menu-group]");
      if (!group && !drawer?.contains(link)) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname !== location.pathname || url.search !== location.search) {
        closeOnArrival();
        return;
      }
      if (drawer?.contains(link)) closeDrawer(false);
      if (group) group.open = false;
    };
    // A page that keeps this header mounted (a row's Note on /admin/weeks changes only the query) leaves its open menu in
    // the DOM when the new body arrives. The address changes when the page does, so the next change to the page after it has
    // changed closes the menus; a page that draws a fresh header has taken this script down with the old one.
    let arrival: MutationObserver | undefined;
    const closeOnArrival = () => {
      arrival?.disconnect();
      const from = location.href;
      arrival = new MutationObserver(() => {
        if (location.href === from) return;
        arrival?.disconnect();
        closeDrawer(false);
        closeGroups();
      });
      arrival.observe(document.body, { childList: true, subtree: true });
    };
    // Tabbing out of an open group (Weekly lists on to Sign out) closes it, or its panel hangs over the page.
    const onFocusIn = (e: FocusEvent) => closeGroups(e.target as Node | null);
    const wide = window.matchMedia("(min-width: 64rem)");
    const onWide = () => {
      if (wide.matches) closeDrawer(false);
    };

    drawer?.addEventListener("toggle", onToggle);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocusIn);
    wide.addEventListener("change", onWide);
    sync();
    return () => {
      drawer?.removeEventListener("toggle", onToggle);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocusIn);
      wide.removeEventListener("change", onWide);
      arrival?.disconnect();
      for (const el of inerted.splice(0)) el.inert = false;
    };
  }, []);

  return null;
}
