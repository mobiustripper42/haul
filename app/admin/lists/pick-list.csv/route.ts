import { pickList, pickListCsv } from "@core/week-lists.js";
import { WEEK_PARAM } from "../../../paths";
import { getRepository } from "../../../services";
import { requireAdmin } from "../../../session";
import { csvResponse } from "../../csv-response";
import { loadWeekLists } from "../week";

/** The chosen week's pick list as a spreadsheet; a week the Week select does not offer is the default week's. */
export async function GET(request: Request): Promise<Response> {
  await requireAdmin();
  const repo = getRepository();
  const { product, week } = await loadWeekLists(repo, new Date(), new URL(request.url).searchParams.get(WEEK_PARAM) ?? undefined);
  const { boxes } = await repo.listWeekBoxes(product.id, week.weekOf, week.cutoff);
  return csvResponse(pickListCsv(product, pickList(product, boxes)), `supper-club-pick-list-${week.weekOf}.csv`);
}
