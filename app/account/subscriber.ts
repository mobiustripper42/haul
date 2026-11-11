import { redirect } from "next/navigation";
import type { Member } from "@core/members.js";
import type { SignupConfirmation } from "@core/ports/repository.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";
import { getRepository } from "../services";
import { requireMember } from "../session";
import { SUPPER_CLUB_PATH } from "../supper-club/paths";

export type Subscribed = { member: Member; product: ProductWithOptions; confirmation: SignupConfirmation };

/**
 * The gate the account pages share (issue 155): the signed-in member, the Supper Club, and their subscription.
 * Signed out → `/sign-in`; no active, paid Supper Club subscription → `/supper-club`.
 */
export async function requireSubscriber(): Promise<Subscribed> {
  const member = await requireMember();
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const confirmation = await repo.findSignupConfirmation(member.id, product.id);
  if (!confirmation) redirect(SUPPER_CLUB_PATH);
  return { member, product, confirmation };
}
