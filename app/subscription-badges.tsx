// Issue 139: a subscription's status as a badge, the one home for its kind and word, as MARKER_BADGES is for weeks
// (app/account/week-markers.ts). Account home, the admin member page and the members list read it.
import type { MessageKey } from "@core/messages/en.js";
import { Badge, type BadgeKind } from "../components/ui/badge";

/** Which Badge kind and catalog key each subscription status takes. */
export const SUBSCRIPTION_BADGES: Readonly<Record<"active" | "cancelled", { kind: BadgeKind; key: MessageKey }>> = {
  active: { kind: "success", key: "account.active" },
  cancelled: { kind: "cancelled", key: "account.cancelled" },
};

/**
 * The status badge and, when `refundOwed`, "Refund owed" beside it, then, when `cardDeclined`, "Card declined": the members table's status cell, the mobile row's
 * badge slot and the admin member page's heading. The words are passed in, as the members list is a client component.
 * `words.status` is the word for `status`.
 */
export function SubscriptionStatus({
  status,
  refundOwed,
  cardDeclined,
  words,
}: {
  status: "active" | "cancelled";
  refundOwed: boolean;
  cardDeclined: boolean;
  words: { status: string; refundOwed: string; cardDeclined: string };
}) {
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <Badge kind={SUBSCRIPTION_BADGES[status].kind}>{words.status}</Badge>
      {refundOwed && <span className="text-small font-semibold text-ink">{words.refundOwed}</span>}
      {cardDeclined && <span className="text-small font-semibold text-ink">{words.cardDeclined}</span>}
    </span>
  );
}
