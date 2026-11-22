/**
 * The id of the panel open in a week's row (Note, Menu, Move days), and the fragment its link carries, so the page
 * opens scrolled to it rather than at the top, where on a phone the panel is below the fold (issue 230). One panel is
 * open at a time, so one id serves them all. Close week and Reopen open at the top of the page and need none.
 */
export const OPEN_PANEL = "open-panel";
