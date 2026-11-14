import { timingSafeEqual } from "node:crypto";
import { runCharges } from "@core/charge-run.js";
import { siteLink } from "@core/email-templates.js";
import { ACCOUNT_PATH } from "../../paths";
import { getEmail, getPayments, getRepository, getSiteUrl } from "../../services";

const BEARER = "Bearer ";

/** The `CRON_SECRET` bearer, in constant time: the exact prefix `Bearer ` and the secret, and never when the secret is unset or empty. */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header === null || !header.startsWith(BEARER)) return false;
  const given = Buffer.from(header.slice(BEARER.length));
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on unequal lengths, so a length check comes first.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Fires the charge run once (DEC-003) and answers with its report as JSON; anything but the secret is a plain 404, so the route is invisible to a scan. */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const siteUrl = getSiteUrl();
  const report = await runCharges({
    repo: getRepository(),
    payments: getPayments(),
    email: getEmail(),
    now: new Date(),
    clock: () => new Date(),
    siteUrl,
    accountUrl: siteLink(siteUrl, ACCOUNT_PATH),
  });
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
