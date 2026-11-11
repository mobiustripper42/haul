// The weeks screen and its actions read the calendar the same way, so they cannot disagree about which weeks exist.
import { upcomingWeeks, type AdminWeek, type ChangedWeek } from "@core/pickup-week.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";
import type { Repository } from "@core/ports/repository.js";

export type Calendar = {
  product: ProductWithOptions;
  /** The 12 weeks the screen lists. */
  weeks: AdminWeek[];
  /** What `pickup_weeks` holds for them, a week with no row being absent. */
  changed: ChangedWeek[];
};

/** The Supper Club's upcoming weeks at `now`, with the rows that make them differ from ordinary weeks. */
export async function loadCalendar(repo: Repository, now: Date): Promise<Calendar> {
  const product = await requireSupperClub(repo);
  const changed = await repo.listChangedWeeks(product.id, product.firstPickupDate);
  return { product, weeks: upcomingWeeks(product, now, changed), changed };
}
