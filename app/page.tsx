import { redirect } from "next/navigation";
import { SUPPER_CLUB_PATH } from "./supper-club/paths";

// `/` goes on to the Supper Club until the Phase 3 landing page takes it back (issue 98). `redirect`
// answers 307, a temporary redirect, which is what leaves `/` free to change.
export default function Home() {
  redirect(SUPPER_CLUB_PATH);
}
