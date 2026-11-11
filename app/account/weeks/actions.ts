"use server";

// Skip and Unskip on Upcoming weeks (issue 137). Each calls `requireSubscriber` first, reads the cutoff from the
// clock at the request, rebuilds the member's rows from the database and acts only when the named week's button is
// the one pressed, and writes under `withActor` so the audit trigger names the member. A passed cutoff goes back
// with the Notice; every other refusal comes from a stale or forged form and goes back silently, as the admin weeks'
// actions do.
import { redirect } from "next/navigation";
import type { UpcomingRow } from "@core/account-weeks.js";
import { cutoffInstant, isDate } from "@core/pickup-week.js";
import { getRepository } from "../../services";
import { textField } from "../../sign-in/shared";
import { ACCOUNT_WEEKS_CUTOFF_ERROR, ACCOUNT_WEEKS_PATH } from "../../paths";
import { requireSubscriber } from "../subscriber";
import { loadUpcomingRows } from "./rows";

const CUTOFF_PASSED_PATH = `${ACCOUNT_WEEKS_PATH}?error=${ACCOUNT_WEEKS_CUTOFF_ERROR}`;

/** The one flow of both actions: only `action` and the repository call differ. */
async function changeWeek(formData: FormData, action: NonNullable<UpcomingRow["action"]>): Promise<never> {
  const subscribed = await requireSubscriber();
  const { member, product, confirmation } = subscribed;
  const now = new Date();
  const week = textField(formData, "week");
  if (isDate(week)) {
    if (cutoffInstant(product, week).getTime() <= now.getTime()) redirect(CUTOFF_PASSED_PATH);
    const rows = await loadUpcomingRows(subscribed, now);
    if (rows.find((row) => row.week.weekOf === week)?.action === action) {
      await getRepository().withActor({ member: member.id }, (scoped) =>
        action === "skip" ? scoped.skipWeek(confirmation.subscriptionId, week) : scoped.unskipWeek(confirmation.subscriptionId, week),
      );
    }
  }
  return redirect(ACCOUNT_WEEKS_PATH);
}

/** Skips a Coming or Week credit week before its cutoff: a skipped ledger row, 0 cents. */
export async function skipWeek(formData: FormData): Promise<void> {
  await changeWeek(formData, "skip");
}

/** Unskips a Skipped week before its cutoff: the skipped row is deleted. */
export async function unskipWeek(formData: FormData): Promise<void> {
  await changeWeek(formData, "unskip");
}
