"use client";

import { useEffect } from "react";
import { holdInert, siblingsAround } from "./inert";

/**
 * What the signed-in header's menus cannot do in CSS (issue 159), as enhancement over `<details>`: with this
 * script off the drawer still opens and closes on its summary and every link and Sign out still work (the model is
 * muster's crew menu, `crew-menu-modal.tsx`).
 *
 * - The drawer: Escape closes it, a tap on the dimmed page closes it (the backdrop is the `<details>`'s own
 *   `::before`, so the tap lands on the details itself), and the rest of the page is made `inert` while it is open,
 *   since the backdrop blocks the pointer and not the keyboard. Inerting is per sibling along the path from the
 *   drawer up, because `inert` cannot be lifted from a subtree once an ancestor sets it (`holdInert`, which a page
 *   that is sending a form shares, so closing the drawer cannot unlock it: issue 240).
 * - The Admin group, and a row's More (issue 220): an outside click, focus moving outside it, or Escape closes it.
 * - A link in a menu closes it at once when it opens the page already showing; a link to another page closes its own menu
 *   on the first change to the page after the address has changed, since a query-only step keeps this header mounted
 *   (issue 245). A menu opened while that page loads stays open, and so does one after a link that opens elsewhere (a ctrl,
 *   cmd or shift click, or a new tab), which leaves this page where it is (issue 240). Back and Forward close every menu.
 * - A link in the header to exactly the address already showing, hash and all (History, once the address ends in `#history`),
 *   closes its menu and scrolls to the element the hash names, at that element's scroll margin: the browser makes no scroll
 *   of its own for an address that has not changed. A bar link too, not only a menu's. Another hash on the page is the
 *   browser's to scroll to.
 * - A drawer left open when the window grows to 1024px, where it is not drawn, is closed: the page would stay inert.
 *
 * Renders nothing.
 */
export function MenuScript() {
  useEffect(() => {
    const drawer = document.querySelector<HTMLDetailsElement>("details[data-menu-drawer]");
    const panel = drawer?.querySelector<HTMLElement>("[data-menu-drawer-panel]");
    const summary = drawer?.querySelector<HTMLElement>("summary");
    let release: (() => void) | undefined;

    /** The drawer is layered over every element beside the path from it up to `<body>`. */
    const sync = () => {
      release?.();
      release = drawer?.open ? holdInert(siblingsAround([drawer])) : undefined;
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
      closeForLinkToHere(e);
    };
    // A link to another page leaves its menu to the new page, which draws its own header with the menus closed (issue 245),
    // so the pending page can show its spinner inside the open menu. A link to the page already showing has no new page
    // coming, so its menu closes at once. A link that opens elsewhere, in a new tab or window, leaves this page as it is,
    // so it closes nothing and waits for nothing (issue 240).
    const closeForLinkToHere = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link) return;
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if ((link.target !== "" && link.target !== "_self") || link.hasAttribute("download")) return;
      const group = link.closest<HTMLDetailsElement>("details[data-menu-group]");
      const inMenu = group !== null || drawer?.contains(link) === true;
      if (!inMenu && link.closest("header") === null) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      const samePage = url.pathname === location.pathname && url.search === location.search;
      // A link to exactly this address, hash and all, changes nothing, so the browser has no scroll of its own to make:
      // the target is scrolled to here, after the menu is closed. A bar link is not in a menu, so this is all it does.
      if (samePage && url.hash !== "" && url.hash === location.hash) {
        if (drawer?.contains(link)) closeDrawer(false);
        if (group) group.open = false;
        scrollToHash(url.hash);
        return;
      }
      if (!inMenu) return;
      if (!samePage) {
        // Its own menu only: one opened while the page loads is the person's, and stays.
        closeOnArrival(group ? () => (group.open = false) : () => closeDrawer(false));
        return;
      }
      if (drawer?.contains(link)) closeDrawer(false);
      if (group) group.open = false;
    };
    // The element a `#hash` names, scrolled into view at its own scroll margin (a column's, for the History list).
    const scrollToHash = (hash: string) => {
      try {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
      } catch {
        // A malformed hash names nothing.
      }
    };
    // A page that keeps this header mounted (a row's Note on /admin/weeks changes only the query) leaves its open menu in
    // the DOM when the new body arrives. The address changes when the page does, so the next change to the page after it has
    // changed closes the menus the links were tapped in; a page that draws a fresh header has taken this script down with the old one.
    let arrival: MutationObserver | undefined;
    let toClose: Array<() => void> = [];
    const closeOnArrival = (close: () => void) => {
      toClose.push(close);
      if (arrival) return;
      const from = location.href;
      arrival = new MutationObserver(() => {
        if (location.href === from) return;
        arrival?.disconnect();
        arrival = undefined;
        for (const closeOne of toClose.splice(0)) closeOne();
      });
      arrival.observe(document.body, { childList: true, subtree: true });
    };
    // Back and Forward step to a page the open menus were not opened for: a query-only step keeps this header mounted, and
    // with it every open menu (issue 240). Any other page draws a fresh header, with the menus closed.
    const onPopState = () => {
      toClose = [];
      arrival?.disconnect();
      arrival = undefined;
      closeDrawer(false);
      closeGroups();
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
    window.addEventListener("popstate", onPopState);
    sync();
    return () => {
      drawer?.removeEventListener("toggle", onToggle);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocusIn);
      wide.removeEventListener("change", onWide);
      window.removeEventListener("popstate", onPopState);
      arrival?.disconnect();
      release?.();
    };
  }, []);

  return null;
}
