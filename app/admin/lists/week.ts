// The weekly lists' three routes and the screen read the week the same way, so they cannot disagree about which week
// is shown (issue 142).
import { listableWeeks, type AdminWeek } from "@core/pickup-week.js";
import type { Repository } from "@core/ports/repository.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";

/**
 * The Supper Club, the weeks the Week select offers at `now` and the one shown: `week` when the select offers it, else the
 * first week it lists (the first upcoming week, unless that one is closed). `cutoffPassed` is the shown week's.
 */
export async function loadWeekLists(
  repo: Repository,
  now: Date,
  week: string | undefined,
): Promise<{ product: ProductWithOptions; weeks: AdminWeek[]; week: AdminWeek; cutoffPassed: boolean }> {
  const product = await requireSupperClub(repo);
  const weeks = listableWeeks(product, now, await repo.listChangedWeeks(product.id, product.firstPickupDate));
  const shown = weeks.find((listed) => listed.weekOf === week) ?? weeks[0];
  if (!shown) throw new Error("The Supper Club has no week to list");
  return { product, weeks, week: shown, cutoffPassed: shown.cutoffPassed };
}
