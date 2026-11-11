"use server";

// The weeks screen's four server actions (docs/SPEC.md §7.2). Each calls `requireAdmin` first, works out what the
// weeks say from the clock and the database, and writes under `withActor` so the audit trigger names the admin.
// A form that asks for what the screen never offers (a closed week's move, an open week's note, a reopen after the
// cutoff, a week that is not listed) goes back to the weeks and writes nothing; only a stale form reaches those.
import { redirect } from "next/navigation";
import { checkMove, isDate, pickupWeek } from "@core/pickup-week.js";
import { ADMIN_WEEKS_PATH } from "../../paths";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { textField } from "../../sign-in/shared";
import { loadCalendar } from "./calendar";

/** A note as saved: trimmed, and no note at all when nothing is left (`note` is `nonblank_text`). */
const noteField = (formData: FormData): string | null => textField(formData, "note") || null;

/** The listed week the form names, its stored row, and the repository; null when the form names none. */
async function weekOf(formData: FormData, now: Date) {
  const repo = getRepository();
  const { product, weeks, changed } = await loadCalendar(repo, now);
  const key = textField(formData, "week");
  const week = weeks.find((listed) => listed.weekOf === key);
  return week ? { repo, product, week, row: changed.find((changedWeek) => changedWeek.weekOf === key) ?? null } : null;
}

/** Closes the week with the note given, granting a week credit to every subscription charged for it. */
export async function closeWeek(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const now = new Date();
  const found = await weekOf(formData, now);
  if (found) {
    const { repo, product, week } = found;
    const note = noteField(formData);
    await repo.withActor({ member: admin.id }, (scoped) => scoped.closePickupWeek(product.id, week.weekOf, note, now));
  }
  redirect(ADMIN_WEEKS_PATH);
}

/** Reopens a week closed before its cutoff: its note is cleared and the week credits its closing gave are withdrawn. */
export async function reopenWeek(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const found = await weekOf(formData, new Date());
  if (found?.week.canReopen) {
    const { repo, product, week } = found;
    await repo.withActor({ member: admin.id }, (scoped) => scoped.reopenPickupWeek(product.id, week.weekOf));
  }
  redirect(ADMIN_WEEKS_PATH);
}

/** Saves a closed week's note, and nothing else about it. A blank note clears it. */
export async function saveWeekNote(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const found = await weekOf(formData, new Date());
  if (found?.row?.closedAt) {
    const { repo, product, row } = found;
    const note = noteField(formData);
    await repo.withActor({ member: admin.id }, (scoped) => scoped.savePickupWeek(product.id, { ...row, note }));
  }
  redirect(ADMIN_WEEKS_PATH);
}

/**
 * Moves an open week's pickup days, or with `putBack` returns them to the ordinary ones. The move is checked in
 * full before anything is written (the database checks are a backstop): a fault sends the form back with the dates
 * entered. Days that are the ordinary ones are saved as no move, so a week with nothing else on it has no row.
 */
export async function moveWeek(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const found = await weekOf(formData, new Date());
  const putBack = formData.has("putBack");
  const firstDay = textField(formData, "firstDay");
  const lastDay = textField(formData, "lastDay");
  if (found && found.week.closedAt === null && (putBack || (isDate(firstDay) && isDate(lastDay)))) {
    const { repo, product, week, row } = found;
    if (!putBack) {
      const fault = checkMove(product, week.weekOf, firstDay, lastDay);
      if (fault !== "ok") {
        redirect(`${ADMIN_WEEKS_PATH}?${new URLSearchParams({ move: week.weekOf, error: fault, first: firstDay, last: lastDay })}`);
      }
    }
    const ordinary = pickupWeek(week.weekOf, null);
    const ordinaryDays = putBack || (firstDay === ordinary.firstDay && lastDay === ordinary.lastDay);
    await repo.withActor({ member: admin.id }, (scoped) =>
      scoped.savePickupWeek(product.id, {
        weekOf: week.weekOf,
        closedAt: null,
        note: row?.note ?? null,
        firstDay: ordinaryDays ? null : firstDay,
        lastDay: ordinaryDays ? null : lastDay,
      }),
    );
  }
  redirect(ADMIN_WEEKS_PATH);
}
