import { siteLink } from "@core/email-templates.js";
import { runMenuRun } from "@core/menu-run.js";
import { ACCOUNT_WEEKS_PATH, ADMIN_WEEKS_PATH, MENU_PATH } from "../../paths";
import { getEmail, getMenuEmailWeekday, getRepository, getSessionSecret, getSiteUrl } from "../../services";
import { authorizedCron } from "../cron-auth";

/**
 * Fires the menu run once (issue 141, DEC-036) and answers with its report as JSON. Anything but the secret is a plain
 * 404 whatever `MENU_EMAIL_WEEKDAY` holds, so the route is invisible to a scan; a weekday that is not 0 to 6 is a 500
 * with no body, and nothing is sent.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorizedCron(request)) return new Response(null, { status: 404 });
  let emailWeekday: number;
  try {
    emailWeekday = getMenuEmailWeekday();
  } catch {
    return new Response(null, { status: 500 });
  }
  const siteUrl = getSiteUrl();
  const report = await runMenuRun({
    repo: getRepository(),
    email: getEmail(),
    now: new Date(),
    siteUrl,
    accountWeeksUrl: siteLink(siteUrl, ACCOUNT_WEEKS_PATH),
    adminWeeksUrl: siteLink(siteUrl, ADMIN_WEEKS_PATH),
    menuUrl: siteLink(siteUrl, MENU_PATH),
    emailWeekday,
    sessionSecret: getSessionSecret(),
  });
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
