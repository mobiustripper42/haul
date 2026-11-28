import { redirect } from "next/navigation";
import { homePath } from "./home-path";

// `homePath` is the rule (issue 136, issue 271). `redirect` answers 307, a temporary redirect, which is what leaves
// `/` free to change.
export default async function Home() {
  redirect(await homePath());
}
