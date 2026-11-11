import { redirect } from "next/navigation";
import { ACCOUNT_PATH } from "./paths";
import { getSignedInMember } from "./session";
import { SUPPER_CLUB_PATH } from "./supper-club/paths";

// A signed-in member, of any role, goes on to their account home (issue 136); everyone else goes on to
// the Supper Club until the Phase 3 landing page takes `/` back (issue 98). `redirect` answers 307, a
// temporary redirect, which is what leaves `/` free to change.
export default async function Home() {
  redirect((await getSignedInMember()) ? ACCOUNT_PATH : SUPPER_CLUB_PATH);
}
