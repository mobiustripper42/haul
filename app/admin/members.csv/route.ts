import { subscribersCsv } from "@core/member-export.js";
import { requireSupperClub } from "@core/products.js";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";

/** The Supper Club's active subscriptions as a spreadsheet, in name order, whatever the screen is searching or sorting by. */
export async function GET(): Promise<Response> {
  await requireAdmin();
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const subscribers = await repo.listSubscribers(product.id);
  return new Response(
    subscribersCsv(
      product.optionTypes.map((type) => type.name),
      subscribers,
    ),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="supper-club-members.csv"',
        "Cache-Control": "no-store",
      },
    },
  );
}
