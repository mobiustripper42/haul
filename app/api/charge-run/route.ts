import { runCharges } from "@core/charge-run.js";
import { ACCOUNT_CARD_PATH } from "@core/account-paths.js";
import { siteLink } from "@core/email-templates.js";
import { ACCOUNT_PATH } from "../../paths";
import { getEmail, getPayments, getRepository, getSiteUrl } from "../../services";
import { authorizedCron } from "../cron-auth";

/** Fires the charge run once (DEC-003) and answers with its report as JSON; anything but the secret is a plain 404, so the route is invisible to a scan. */
export async function GET(request: Request): Promise<Response> {
  if (!authorizedCron(request)) return new Response(null, { status: 404 });
  const siteUrl = getSiteUrl();
  const report = await runCharges({
    repo: getRepository(),
    payments: getPayments(),
    email: getEmail(),
    now: new Date(),
    clock: () => new Date(),
    siteUrl,
    accountUrl: siteLink(siteUrl, ACCOUNT_PATH),
    cardUrl: siteLink(siteUrl, ACCOUNT_CARD_PATH),
  });
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
