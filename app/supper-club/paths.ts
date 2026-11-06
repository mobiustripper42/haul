// The Supper Club page's panes: the one home for their paths, imported by the actions, the pages, the
// header link and the continue route. A plain file: a "use server" file exports only async functions.
import type { FlowPages } from "../sign-in/shared";

/** The Supper Club page: where a pane returns to when no return path is held. */
export const SUPPER_CLUB_PATH = "/supper-club";

/** The signup confirmation, in the right pane. */
export const SUPPER_CLUB_DONE_PATH = "/supper-club/done";

/** What a member who already has a box is told, in the right pane. */
export const SUPPER_CLUB_ALREADY_PATH = "/supper-club/already";

/** The farm's own site, where the confirmation sends a member back to. */
export const FARM_SITE_URL = "https://ohiocityfarm.com";

/** Create Account in the pane; a confirmed code with no return path held lands on the Supper Club page. */
export const PANE_CREATE_PAGES: FlowPages = {
  start: "/supper-club/create-account",
  code: "/supper-club/create-account/code",
  done: SUPPER_CLUB_PATH,
};

/** Sign-in in the pane; a confirmed code with no return path held lands on the Supper Club page. */
export const PANE_SIGN_IN_PAGES: FlowPages = {
  start: "/supper-club/sign-in",
  code: "/supper-club/sign-in/code",
  done: SUPPER_CLUB_PATH,
};
