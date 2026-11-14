import { subscribersCsv } from "@core/member-export.js";
import { requireSupperClub } from "@core/products.js";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { csvResponse } from "../csv-response";

/** The Supper Club's active subscriptions as a spreadsheet, in name order, whatever the screen is searching or sorting by. */
export async function GET(): Promise<Response> {
  await requireAdmin();
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const subscribers = (await repo.listSubscribers(product.id)).filter((subscriber) => subscriber.status === "active");
  return csvResponse(
    subscribersCsv(
      product.optionTypes.map((type) => type.name),
      subscribers,
    ),
    "supper-club-members.csv",
  );
}
