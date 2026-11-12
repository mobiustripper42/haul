import { redirect } from "next/navigation";
import type { Member } from "@core/members.js";
import type { MemberSubscription } from "@core/ports/repository.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";
import { getRepository } from "../services";
import { requireMember } from "../session";
import { SUPPER_CLUB_PATH } from "../supper-club/paths";

export type Subscribed = { member: Member; product: ProductWithOptions; confirmation: MemberSubscription };

/**
 * The gate the account pages share (issue 155): the signed-in member, the Supper Club, and their newest subscription,
 * active or cancelled (issue 139), so a paid week still to come stays in reach after a cancel and a rejoin shows the new
 * one. Signed out → `/sign-in`; no paid Supper Club subscription → `/supper-club`.
 */
export async function requireSubscriber(): Promise<Subscribed> {
  const member = await requireMember();
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const confirmation = await repo.findMemberSubscription(member.id, product.id);
  if (!confirmation) redirect(SUPPER_CLUB_PATH);
  return { member, product, confirmation };
}
