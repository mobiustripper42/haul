import { timingSafeEqual } from "node:crypto";

const BEARER = "Bearer ";

/**
 * The `CRON_SECRET` bearer, in constant time, read at each call: the exact prefix `Bearer ` and the secret, and never
 * when the secret is unset or empty. The one check the charge run's route and the menu run's share.
 */
export function authorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header === null || !header.startsWith(BEARER)) return false;
  const given = Buffer.from(header.slice(BEARER.length));
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on unequal lengths, so a length check comes first.
  return given.length === expected.length && timingSafeEqual(given, expected);
}
