import type { HistoryRow, UpcomingRow } from "@core/account-weeks.js";
import type { MessageKey } from "@core/messages/en.js";
import type { BadgeKind } from "../../components/ui/badge";

/** The markers that take a badge: a coming week takes none, for the whole of Upcoming weeks is coming (PR #160). */
export type Marker = Exclude<UpcomingRow["marker"] | HistoryRow["marker"], "coming">;

/** Which Badge kind and catalog key each marker takes, on both account pages (issue 155). */
export const MARKER_BADGES: Readonly<Record<Marker, { kind: BadgeKind; key: MessageKey }>> = {
  paid: { kind: "success", key: "account.marker.paid" },
  closed: { kind: "closed", key: "account.marker.closed" },
  weekCredit: { kind: "note", key: "account.marker.weekCredit" },
  noMeal: { kind: "closed", key: "account.marker.noMeal" },
};
