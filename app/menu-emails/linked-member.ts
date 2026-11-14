import { notFound } from "next/navigation";
import { menuEmailTokenMatches } from "@core/menu-email-link.js";
import type { Member } from "@core/members.js";
import { getRepository, getSessionSecret } from "../services";

/**
 * The member an off link or a form on the menu emails page names (`m`), when its token (`t`) is theirs under the session
 * secret; Next's not-found page for a token that does not match, and for a member nobody has. The one home of the check
 * (issue 141, AC8): the route handler, the page and both actions each run it before they read or write anything.
 */
export async function linkedMember(memberId: string, token: string): Promise<Member> {
  if (!menuEmailTokenMatches(memberId, token, getSessionSecret())) notFound();
  const member = await getRepository().findMemberById(memberId);
  if (!member) notFound();
  return member;
}
