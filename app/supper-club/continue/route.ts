import { redirect } from "next/navigation";
import { choicesQuery, resolveChoices } from "@core/choices.js";
import { requireSupperClub } from "@core/products.js";
import { RETURN_TO_COOKIE } from "../../session";
import { getRepository } from "../../services";
import { setFlowCookie } from "../../sign-in/shared";

/**
 * The Supper Club form's target. The form is a plain GET, so the choices arrive as the query: they are
 * resolved against the product (a missing or foreign choice becomes the type's first option) and kept
 * in `RETURN_TO_COOKIE` as the path to come back to. `next=create-account` goes to Create Account;
 * anything else goes to sign-in.
 */
export async function GET(request: Request): Promise<Response> {
  const product = await requireSupperClub(getRepository());

  const params = new URL(request.url).searchParams;
  const query = Object.fromEntries(product.optionTypes.map((type) => [type.id, params.get(type.id) ?? undefined]));
  await setFlowCookie(RETURN_TO_COOKIE, `/supper-club?${choicesQuery(resolveChoices(product, query))}`);
  redirect(params.get("next") === "create-account" ? "/create-account" : "/sign-in");
}
