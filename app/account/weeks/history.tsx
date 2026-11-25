import type { ReactNode } from "react";
import type { HistoryRow } from "@core/account-weeks.js";
import type { Language, Translator } from "@core/i18n.js";
import { mealLabel } from "@core/member-list.js";
import { formatUsdWhole } from "@core/money.js";
import { listedWeekTitle } from "@core/pickup-week.js";
import type { MemberWeeks } from "@core/ports/repository.js";
import { Badge } from "../../../components/ui/badge";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { WeekList } from "../../../components/ui/week-list";
import { MARKER_BADGES } from "../week-markers";

/** The key of a History row's one status line. */
const LINES = {
  signup: "account.history.signup",
  paid: "account.marker.paid",
  closed: "account.marker.closed",
  closedPaid: "account.history.closedPaid",
  skipped: "account.weeks.skipped",
  weekCredit: "account.weeks.weekCredit",
  locked: "account.history.locked",
  declined: "account.history.declined",
} as const satisfies Record<HistoryRow["line"], string>;

/**
 * A member's History (issue 155), the right column of Upcoming weeks (issue 243): their past weeks, newest first, from the
 * ledger. Read only. With no past week its card holds one line saying so. Called inline, `{History({ ... })}`.
 */
export function History({ past, ledger, t, language }: { past: HistoryRow[]; ledger: MemberWeeks; t: Translator; language: Language }): ReactNode {
  // Each paid week shows the picks it was charged for: the set in effect for that week (issue 138), never the newest.
  const mealOf = new Map(ledger.paid.map((row) => [row.weekOf, mealLabel(row.options)]));
  const rows = past.map((row) => {
    const meal = mealOf.get(row.week.weekOf);
    return {
      id: row.week.weekOf,
      title: listedWeekTitle(t, row.week, language),
      lines: [...(meal === undefined ? [] : [meal]), t(LINES[row.line])],
      amount: formatUsdWhole(row.amountCents ?? 0),
      badge: <Badge kind={MARKER_BADGES[row.marker].kind}>{t(MARKER_BADGES[row.marker].key)}</Badge>,
    };
  });

  return (
    <>
      <Heading level={2} look="title">
        {t("account.history.title")}
      </Heading>
      <Hint>{t("account.history.intro")}</Hint>
      <Card width="fill">
        <WeekList rows={rows} empty={t("account.history.empty")} />
      </Card>
    </>
  );
}
