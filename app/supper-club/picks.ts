import { requireSupperClub } from "@core/products.js";
import type { Repository } from "@core/ports/repository.js";

/** The picks of the member's pending signup, as choices (option type id to option id); null when there is none. */
export async function picksOf(repo: Repository, memberId: string): Promise<Record<string, string> | null> {
  const product = await requireSupperClub(repo);
  const row = await repo.findPendingSignup(memberId, product.id);
  if (!row) return null;
  return Object.fromEntries(
    product.optionTypes.flatMap((type) => {
      const picked = type.options.find((option) => row.optionIds.includes(option.id));
      return picked ? [[type.id, picked.id]] : [];
    }),
  );
}
