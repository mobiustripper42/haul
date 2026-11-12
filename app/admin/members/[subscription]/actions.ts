"use server";

// An admin's cancel for a member (issue 139): the same repository write as the member's own, run as the admin so the
// audit row names the admin's member id as who acted. It checks no cutoff. A subscription already cancelled, or one
// the form names wrongly, writes nothing, and the admin lands on the member page either way.
import { redirect } from "next/navigation";
import { adminMemberPath } from "../../../paths";
import { getRepository } from "../../../services";
import { requireAdmin } from "../../../session";
import { textField } from "../../../sign-in/shared";

/** Cancels the subscription the form posts as `subscription`, as the admin, and goes back to its member page. */
export async function cancelForMember(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const subscriptionId = textField(formData, "subscription");
  const now = new Date();
  await getRepository().withActor({ member: admin.id }, (repo) => repo.cancelSubscription(subscriptionId, now));
  redirect(adminMemberPath(subscriptionId));
}
