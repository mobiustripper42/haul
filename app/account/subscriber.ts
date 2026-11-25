import type { Member } from "@core/members.js";
import type { MemberSubscription } from "@core/ports/repository.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";
import { getRepository } from "../services";
import { requireMember } from "../session";

/** A signed-in member's account (issue 260): the member, the Supper Club, and their newest subscription or null for a member who never joined. */
export type Account = { member: Member; product: ProductWithOptions; confirmation: MemberSubscription | null };

/** An account holding a subscription, active or cancelled: what the weeks' loaders and `declinedNotice` read. */
export type Subscribed = Account & { confirmation: MemberSubscription };

/**
 * The gate the account pages share (issue 155, issue 260): the signed-in member, the Supper Club, and their newest subscription,
 * active or cancelled (issue 139), so a paid week still to come stays in reach after a cancel and a rejoin shows the new
 * one, or null for a member who never joined. Signed out → `/sign-in`; it never sends a member elsewhere for lacking a
 * subscription, so each caller handles `confirmation: null` (DEC-055).
 */
export async function requireAccount(): Promise<Account> {
  const member = await requireMember();
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const confirmation = await repo.findMemberSubscription(member.id, product.id);
  return { member, product, confirmation };
}
