// Issue 141: the menu emails paths, alone in a file with no imports so `app/paths.ts`, which client components import, can
// reach them without pulling in the signing (`node:crypto`). `src/menu-email-link.ts` re-exports them.

/** The page the off link lands on. */
export const MENU_EMAILS_PATH = "/menu-emails";

/** The route handler that writes the preference off and redirects to the page. */
export const MENU_EMAILS_OFF_PATH = "/menu-emails/off";
