"use server";

// Skip, Unskip (issue 137) and Switch (issue 138) on Upcoming weeks; Switch's form is on the account page (issue 219) and
// lands back there. Each calls `requireAccount` first, writes nothing for a member who never joined (issue 260), reads the
// cutoff from the clock at the request, rebuilds the member's rows from the database and acts only when the named
// week is the one its rule names (the week's button, or the switch week), and writes under `withActor` so the audit
// trigger names the member. A passed cutoff goes back with the Notice; every other refusal comes from a stale or
// forged form and goes back silently, as the admin weeks' actions do.
import { redirect } from "next/navigation";
import { lockedWeek, type UpcomingRow } from "@core/account-weeks.js";
import { cutoffInstant, isDate } from "@core/pickup-week.js";
import type { Repository } from "@core/ports/repository.js";
import { priceOfChoices } from "@core/products.js";
import { strictChoices, switchWeek } from "@core/switch-meal.js";
import { getRepository } from "../../services";
import { textField } from "../../sign-in/shared";
import { ACCOUNT_PATH, ACCOUNT_SWITCH_ERROR_PARAM, ACCOUNT_WEEKS_CUTOFF_ERROR, ACCOUNT_WEEKS_PATH } from "../../paths";
import { requireAccount, type Subscribed } from "../subscriber";
import { loadUpcomingRows } from "./rows";

/** Where a request refused at its cutoff lands, by where the action returns to: a Switch on the account page, the rest on Upcoming weeks. */
const cutoffPassedPath = (back: string): string =>
  back === ACCOUNT_PATH ? `${ACCOUNT_PATH}?${ACCOUNT_SWITCH_ERROR_PARAM}=${ACCOUNT_WEEKS_CUTOFF_ERROR}` : `${ACCOUNT_WEEKS_PATH}?error=${ACCOUNT_WEEKS_CUTOFF_ERROR}`;

/** What an action does with the member's rows and the week posted: the write to run as the member, or null to refuse. */
type Change = (context: { subscribed: Subscribed; rows: UpcomingRow[]; week: string }) => ((repo: Repository) => Promise<unknown>) | null;

/** The one flow of every action, returning to `back`: only `change` differs. */
async function changeWeek(formData: FormData, change: Change, back: string): Promise<never> {
  const { member, product, confirmation } = await requireAccount();
  // A member who never joined has no week to change: back to where the form was, with nothing written and no error.
  if (confirmation === null) return redirect(back);
  const subscribed = { member, product, confirmation };
  const now = new Date();
  const week = textField(formData, "week");
  if (isDate(week)) {
    if (cutoffInstant(product, week).getTime() <= now.getTime()) redirect(cutoffPassedPath(back));
    const rows = await loadUpcomingRows(subscribed, now);
    const write = change({ subscribed, rows, week });
    if (write) await getRepository().withActor({ member: member.id }, write);
  }
  return redirect(back);
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
  await changeWeek(formData, weekButton("skip"), ACCOUNT_WEEKS_PATH);
}

/** Unskips a Skipped week before its cutoff: the skipped row is deleted. */
export async function unskipWeek(formData: FormData): Promise<void> {
  await changeWeek(formData, weekButton("unskip"), ACCOUNT_WEEKS_PATH);
}

/**
 * Switches the subscription's size or menu from its switch week on, priced as signup prices the picks. The week
 * posted must be the switch week and the form must name one option of every type; anything else is refused.
 */
export async function switchMeal(formData: FormData): Promise<void> {
  await changeWeek(formData, ({ subscribed, rows, week }) => {
    const { product, confirmation } = subscribed;
    const choices = strictChoices(product, formData);
    if (choices === null || switchWeek(rows, lockedWeek(confirmation)) !== week) return null;
    return (repo) => repo.switchPicks(confirmation.subscriptionId, choices, week, priceOfChoices(product, choices));
  }, ACCOUNT_PATH);
}
