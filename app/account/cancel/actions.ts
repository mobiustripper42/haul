"use server";

// The member's cancel (issue 139). It acts only on the subscription `requireSubscriber` gives the signed-in member,
// never on an id the form posts, and checks no cutoff: a member can cancel at any time. It writes under `withActor`
// so the audit trigger names the member. A subscription already cancelled, a double submit or a stale form, is not
// an error: `cancelSubscription` writes nothing and the member lands on account home either way.
import { redirect } from "next/navigation";
import { ACCOUNT_PATH } from "../../paths";
import { getRepository } from "../../services";
import { requireSubscriber } from "../subscriber";

/** Cancels the subscription `requireSubscriber` gives the member, whatever the form posts, and goes back to `/account`. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a form action's signature: this one reads nothing the form posts
export async function cancelSubscription(_formData: FormData): Promise<void> {
  const { member, confirmation } = await requireSubscriber();
  const now = new Date();
  await getRepository().withActor({ member: member.id }, (repo) => repo.cancelSubscription(confirmation.subscriptionId, now));
  redirect(ACCOUNT_PATH);
}
