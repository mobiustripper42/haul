/**
 * The id of the week's row whose panel is open (Note, Menu, Move days), and the fragment the panel's link carries, so
 * the page opens on that row, its title naming the week and the panel below it, rather than at the top, where on a
 * phone the panel is below the fold (issue 230). One panel is open at a time, so one id serves them all. Close week and
 * Reopen open at the top of the page and need none.
 */
export const OPEN_PANEL = "open-panel";
