"use client";

import { useState, type ReactNode } from "react";
import { filterMembers, mealLabel, nextSort, OPENING_SORT, SORT_CHOICES, sortMembers, subscriberName, type MemberRow, type Sort, type SortKey } from "@core/member-list.js";
import type { Language } from "@core/i18n.js";
import { formatShortDate } from "@core/pickup-week.js";
import { formatPhone } from "@core/phone.js";
import type { Subscriber } from "@core/ports/repository.js";
import { Button } from "../../components/ui/button";
import { DataTable, type DataTableColumn } from "../../components/ui/data-table";
import { Field } from "../../components/ui/field";
import { Hint } from "../../components/ui/hint";
import { RolldownToggle } from "../../components/ui/rolldown-toggle";
import { RowList } from "../../components/ui/row-list";
import { SearchField } from "../../components/ui/search-field";
import { Select } from "../../components/ui/select";
import { TextLink } from "../../components/ui/text-link";
import { fill } from "../fill";
import { adminMemberPath } from "../paths";
import { SubscriptionStatus } from "../subscription-badges";

/**
 * The words the page has translated for this list, which a client component cannot get for itself. `noMatch`
 * holds `{q}` and `joinedLine` holds `{meal}` and `{date}`, filled here as the admin types. `status` is the word for
 * each subscription status, `refundOwed` the one a cancelled row holding an unspent week credit adds beside it and `cardDeclined` the one an active row holding a declined charge adds.
 * `past` is the button that opens every person's earlier subscriptions, and `earlier` the toggle under a person with some,
 * holding `{n}` (issue 263).
 */
export type MembersListText = {
  search: string;
  searchPlaceholder: string;
  noMatch: string;
  columns: Record<"name" | "email" | "phone" | "meal" | "joined" | "status", string>;
  status: Record<"active" | "cancelled", string>;
  refundOwed: string;
  cardDeclined: string;
  sortBy: string;
  sortLabels: Record<SortKey, string>;
  joinedLine: string;
  past: string;
  earlier: string;
};

const SORT_BY_ID = "members-sort";
const SEARCH_ID = "members-search";

/**
 * The members' search box with Past beside it, the table (from 720px up) and the stacked rows with their "Sort by" select
 * (below it). A row is a person, drawn from their current subscription, with their earlier subscriptions rolled up under
 * it (issue 263). Search and sort run here, in the browser, over every person the page sent; nothing about them is in the
 * URL. The list opens sorted by name, ascending (`OPENING_SORT`), every rolldown closed. The people whose rolldown is open
 * are one set; Past opens every person's, or closes every one when all are open.
 */
export function MembersList({ rows, text, language }: { rows: MemberRow[]; text: MembersListText; language: Language }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(OPENING_SORT);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = sortMembers(filterMembers(rows, query), sort);
  const rolled = rows.filter((person) => person.earlier.length > 0);
  const allOpen = rolled.length > 0 && rolled.every((person) => open.has(person.memberId));
  const toggle = (memberId: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(memberId)) next.add(memberId);
      return next;
    });
  /** The person's name, linking to their current subscription's member page. */
  const nameOf = ({ current }: MemberRow) => <TextLink href={adminMemberPath(current.subscriptionId)}>{subscriberName(current)}</TextLink>;
  /** A person's toggle, "{n} earlier". */
  const toggleOf = (person: MemberRow) => (
    <RolldownToggle open={open.has(person.memberId)} onToggle={() => toggle(person.memberId)}>
      {fill(text.earlier, { n: String(person.earlier.length) })}
    </RolldownToggle>
  );
  /** A subscription's Meal, Joined and Status cells, for a person's row and for each of their earlier lines. */
  const subscriptionCells = (row: Subscriber): ReactNode[] => [mealLabel(row.options), formatShortDate(row.joinedDate, language), statusOf(row)];
  /** A subscription's phone line: its meal and joined date, with its status beside it, for a person's row and each earlier line. */
  const joinedLineOf = (row: Subscriber) => fill(text.joinedLine, { meal: mealLabel(row.options), date: formatShortDate(row.joinedDate, language) });
  /** The subscription's status badge, with "Refund owed" and "Card declined" beside it when they apply. */
  const statusOf = (row: Subscriber) => (
    <SubscriptionStatus
      status={row.status}
      refundOwed={row.refundOwed}
      cardDeclined={row.cardDeclined}
      words={{ status: text.status[row.status], refundOwed: text.refundOwed, cardDeclined: text.cardDeclined }}
    />
  );

  const header = (id: keyof MembersListText["columns"], key?: SortKey): DataTableColumn => ({
    id,
    label: text.columns[id],
    ...(key && {
      sort: {
        direction: sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none",
        onSort: () => setSort(nextSort(sort, key)),
      },
    }),
  });

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SearchField
            id={SEARCH_ID}
            label={text.search}
            placeholder={text.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button kind="secondary" type="button" nowrap pressed={allOpen} onClick={() => setOpen(allOpen ? new Set() : new Set(rolled.map((person) => person.memberId)))}>
          {text.past}
        </Button>
      </div>
      <DataTable
        columns={[header("name", "name"), header("email"), header("phone"), header("meal", "meal"), header("joined", "joined"), header("status", "status")]}
        rows={shown.map((person) => ({
          id: person.current.subscriptionId,
          cells: [
            person.earlier.length > 0 ? (
              <div className="flex flex-col items-start">
                {nameOf(person)}
                {toggleOf(person)}
              </div>
            ) : (
              nameOf(person)
            ),
            person.current.email,
            formatPhone(person.current.phone),
            ...subscriptionCells(person.current),
          ],
          under: open.has(person.memberId) ? person.earlier.map((earlier) => ({ id: earlier.subscriptionId, cells: ["", "", "", ...subscriptionCells(earlier)] })) : undefined,
        }))}
      />
      <RowList
        before={
          <Field label={text.sortBy} htmlFor={SORT_BY_ID}>
            <Select
              id={SORT_BY_ID}
              name={SORT_BY_ID}
              value={sort.key}
              options={SORT_CHOICES.map((choice) => ({ value: choice.key, label: text.sortLabels[choice.key] }))}
              onChange={(event) => {
                const choice = SORT_CHOICES.find((candidate) => candidate.key === event.target.value);
                if (choice) setSort(choice);
              }}
            />
          </Field>
        }
        rows={shown.map((person) => ({
          id: person.current.subscriptionId,
          title: nameOf(person),
          badge: statusOf(person.current),
          detail: joinedLineOf(person.current),
          note: [person.current.email, formatPhone(person.current.phone)].filter(Boolean).join(" · "),
          under:
            person.earlier.length > 0 ? (
              <>
                {toggleOf(person)}
                {open.has(person.memberId) &&
                  person.earlier.map((earlier) => (
                    <span key={earlier.subscriptionId} className="flex items-start justify-between gap-3 text-small text-ink-muted">
                      <span>{joinedLineOf(earlier)}</span>
                      {statusOf(earlier)}
                    </span>
                  ))}
              </>
            ) : undefined,
        }))}
      />
      {shown.length === 0 && <Hint>{fill(text.noMatch, { q: query })}</Hint>}
    </>
  );
}
