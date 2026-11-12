"use server";

// Skip, Unskip (issue 137) and Switch (issue 138) on Upcoming weeks. Each calls `requireSubscriber` first, reads the
// cutoff from the clock at the request, rebuilds the member's rows from the database and acts only when the named
// week is the one its rule names (the week's button, or the switch week), and writes under `withActor` so the audit
// trigger names the member. A passed cutoff goes back with the Notice; every other refusal comes from a stale or
// forged form and goes back silently, as the admin weeks' actions do.
import { redirect } from "next/navigation";
import type { UpcomingRow } from "@core/account-weeks.js";
import { cutoffInstant, isDate } from "@core/pickup-week.js";
import type { Repository } from "@core/ports/repository.js";
import { priceOfChoices } from "@core/products.js";
import { strictChoices, switchWeek } from "@core/switch-meal.js";
import { getRepository } from "../../services";
import { textField } from "../../sign-in/shared";
import { ACCOUNT_WEEKS_CUTOFF_ERROR, ACCOUNT_WEEKS_PATH } from "../../paths";
import { requireSubscriber, type Subscribed } from "../subscriber";
import { loadUpcomingRows } from "./rows";

const CUTOFF_PASSED_PATH = `${ACCOUNT_WEEKS_PATH}?error=${ACCOUNT_WEEKS_CUTOFF_ERROR}`;

/** What an action does with the member's rows and the week posted: the write to run as the member, or null to refuse. */
type Change = (context: { subscribed: Subscribed; rows: UpcomingRow[]; week: string }) => ((repo: Repository) => Promise<unknown>) | null;

/** The one flow of every action: only `change` differs. */
async function changeWeek(formData: FormData, change: Change): Promise<never> {
  const subscribed = await requireSubscriber();
  const { member, product } = subscribed;
  const now = new Date();
  const week = textField(formData, "week");
  if (isDate(week)) {
    if (cutoffInstant(product, week).getTime() <= now.getTime()) redirect(CUTOFF_PASSED_PATH);
    const rows = await loadUpcomingRows(subscribed, now);
    const write = change({ subscribed, rows, week });
    if (write) await getRepository().withActor({ member: member.id }, write);
  }
  return redirect(ACCOUNT_WEEKS_PATH);
}

/** Skip or Unskip: the write only when the named week's button is `action`. */
const weekButton =
  (action: NonNullable<UpcomingRow["action"]>): Change =>
  ({ subscribed, rows, week }) =>
    rows.find((row) => row.week.weekOf === week)?.action === action
      ? (repo) => (action === "skip" ? repo.skipWeek(subscribed.confirmation.subscriptionId, week) : repo.unskipWeek(subscribed.confirmation.subscriptionId, week))
      : null;

/** Skips a Coming or Week credit week before its cutoff: a skipped ledger row, 0 cents. */
export async function skipWeek(formData: FormData): Promise<void> {
  await changeWeek(formData, weekButton("skip"));
}

/** Unskips a Skipped week before its cutoff: the skipped row is deleted. */
export async function unskipWeek(formData: FormData): Promise<void> {
  await changeWeek(formData, weekButton("unskip"));
}

/**
 * Switches the subscription's size or menu from its switch week on, priced as signup prices the picks. The week
 * posted must be the switch week and the form must name one option of every type; anything else is refused.
 */
export async function switchMeal(formData: FormData): Promise<void> {
  await changeWeek(formData, ({ subscribed, rows, week }) => {
    const { product, confirmation } = subscribed;
    const choices = strictChoices(product, formData);
    if (choices === null || switchWeek(rows) !== week) return null;
    return (repo) => repo.switchPicks(confirmation.subscriptionId, choices, week, priceOfChoices(product, choices));
  });
}
