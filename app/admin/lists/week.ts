// The weekly lists' three routes and the screen read the week the same way, so they cannot disagree about which week
// is shown (issue 142).
import { defaultListedWeek, listableWeeks, type AdminWeek } from "@core/pickup-week.js";
import type { Repository } from "@core/ports/repository.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";

/**
 * The Supper Club, the weeks the Week select offers at `now` and the one shown: `week` when the select offers it, else
 * `defaultListedWeek`'s (issue 272: the current week, or the first open one after it). `cutoffPassed` is the shown week's.
 */
export async function loadWeekLists(
  repo: Repository,
  now: Date,
  week: string | undefined,
): Promise<{ product: ProductWithOptions; weeks: AdminWeek[]; week: AdminWeek; cutoffPassed: boolean }> {
  const product = await requireSupperClub(repo);
  const changed = await repo.listChangedWeeks(product.id, product.firstPickupDate);
  const weeks = listableWeeks(product, now, changed);
  // When every week from the current one on is closed, the default is the first listed week, a past one with nothing to
  // pack: the admin picks another from the dropdown.
  const shown = weeks.find((listed) => listed.weekOf === week) ?? defaultListedWeek(product, now, changed, weeks);
  if (!shown) throw new Error("The Supper Club has no week to list");
  return { product, weeks, week: shown, cutoffPassed: shown.cutoffPassed };
}
