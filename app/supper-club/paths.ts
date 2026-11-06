// The Supper Club page's panes: the one home for their paths, imported by the actions, the pages, the
// header link and the continue route. A plain file: a "use server" file exports only async functions.
import type { FlowPages } from "../sign-in/shared";

/** The Supper Club page: where a pane returns to when no return path is held. */
export const SUPPER_CLUB_PATH = "/supper-club";

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
