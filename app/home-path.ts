import { ACCOUNT_PATH } from "./paths";
import { getSignedInMember } from "./session";
import { SUPPER_CLUB_PATH } from "./supper-club/paths";

// Issue 271: where a visitor goes on from `/` and from the Not Found page. A signed-in member, of any role, goes on to
// their account home (issue 136); everyone else goes on to the Supper Club until the Phase 3 landing page takes `/`
// back (issue 98).
export async function homePath(): Promise<string> {
  return (await getSignedInMember()) ? ACCOUNT_PATH : SUPPER_CLUB_PATH;
}
