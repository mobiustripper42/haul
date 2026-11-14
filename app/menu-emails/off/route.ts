import { redirect } from "next/navigation";
import { menuEmailsPath } from "../../paths";
import { getRepository } from "../../services";
import { linkedMember } from "../linked-member";

/**
 * The menu email's off link (issue 141, AC8): `?m=<member>&t=<token>`. A token that is the member's turns their menu
 * emails off, as the member's own act, and lands on the page, which only reads; any other is Next's not-found page and
 * writes nothing. Opened twice, it leaves the same state.
 */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const memberId = query.get("m") ?? "";
  const token = query.get("t") ?? "";
  const member = await linkedMember(memberId, token);
  await getRepository().withActor({ member: member.id }, (scoped) => scoped.setMenuEmails(member.id, false));
  redirect(menuEmailsPath(memberId, token));
}
