import type { Language } from "@core/i18n.js";
import { subscriberName } from "@core/member-list.js";
import { formatShortDate } from "@core/pickup-week.js";
import { formatPhone } from "@core/phone.js";
import type { UnsubscribedMember } from "@core/ports/repository.js";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { DataTable } from "../../components/ui/data-table";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { RowList } from "../../components/ui/row-list";
import { fill } from "../fill";

/**
 * Issue 263: the words the page has translated for the never-subscribed card. `accountMadeLine` holds `{date}`.
 */
export type NeverSubscribedText = {
  title: string;
  intro: string;
  empty: string;
  columns: Record<"name" | "email" | "phone" | "accountMade", string>;
  notConfirmed: string;
  accountMadeLine: string;
};

/**
 * Issue 263: the never-subscribed card, whole: people with an account who have never paid for a subscription, in the
 * order given (newest account first), as a table from 720px up and stacked rows below it, or the empty line when there
 * are none. An email not yet confirmed carries the Not confirmed badge.
 */
export function NeverSubscribedList({ rows, text, language }: { rows: UnsubscribedMember[]; text: NeverSubscribedText; language: Language }) {
  const notConfirmed = <Badge kind="unconfirmed">{text.notConfirmed}</Badge>;
  return (
    <Card width="fill">
      <Heading level={2}>{text.title}</Heading>
      <Hint>{text.intro}</Hint>
      {rows.length === 0 ? (
        <p className="text-ink-muted">{text.empty}</p>
      ) : (
        <>
          <DataTable
            columns={[
              { id: "name", label: text.columns.name },
              { id: "email", label: text.columns.email },
              { id: "phone", label: text.columns.phone },
              { id: "accountMade", label: text.columns.accountMade },
            ]}
            rows={rows.map((row) => ({
              id: row.memberId,
              cells: [
                subscriberName(row),
                <span key="email" className="flex flex-wrap items-center gap-2">
                  {row.email}
                  {!row.confirmed && notConfirmed}
                </span>,
                formatPhone(row.phone),
                formatShortDate(row.createdDate, language),
              ],
            }))}
          />
          <RowList
            rows={rows.map((row) => ({
              id: row.memberId,
              title: subscriberName(row),
              badge: row.confirmed ? null : notConfirmed,
              detail: fill(text.accountMadeLine, { date: formatShortDate(row.createdDate, language) }),
              note: [row.email, formatPhone(row.phone)].filter(Boolean).join(" · "),
            }))}
          />
        </>
      )}
    </Card>
  );
}
