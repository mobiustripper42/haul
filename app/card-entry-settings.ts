import type { Member } from "@core/members.js";
import { isProduction } from "./services";

/**
 * Issue 145: what the card entry is given, the one home for the signup page and the card page: whether its test field
 * stands in for Square's script (the e2e server alone, as the dev outbox does), Square's ids, and the member's billing
 * details.
 */
export function cardEntrySettings(member: Member): {
  testMode: boolean;
  applicationId: string | undefined;
  locationId: string | undefined;
  billing: { email: string; givenName?: string; familyName?: string };
} {
  return {
    testMode: !isProduction() && process.env.E2E === "1",
    applicationId: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
    locationId: process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
    billing: {
      email: member.email,
      ...(member.firstName !== null && { givenName: member.firstName }),
      ...(member.lastName !== null && { familyName: member.lastName }),
    },
  };
}
