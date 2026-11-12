"use client";

import { useState } from "react";
import { filterSubscribers, mealLabel, nextSort, OPENING_SORT, SORT_CHOICES, sortSubscribers, subscriberName, type Sort, type SortKey } from "@core/member-list.js";
import type { Language } from "@core/i18n.js";
import { formatShortDate } from "@core/pickup-week.js";
import type { Subscriber } from "@core/ports/repository.js";
import { DataTable, type DataTableColumn } from "../../components/ui/data-table";
import { Field } from "../../components/ui/field";
import { Hint } from "../../components/ui/hint";
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
 * each subscription status, and `refundOwed` the one a cancelled row holding an unspent week credit adds beside it.
 */
export type MembersListText = {
  search: string;
  searchPlaceholder: string;
  noMatch: string;
  columns: Record<"name" | "email" | "phone" | "meal" | "joined" | "status", string>;
  status: Record<"active" | "cancelled", string>;
  refundOwed: string;
  sortBy: string;
  sortLabels: Record<SortKey, string>;
  joinedLine: string;
};

const SORT_BY_ID = "members-sort";
const SEARCH_ID = "members-search";

/**
 * The members' search box, the table (from 720px up) and the stacked rows with their "Sort by" select (below it).
 * Search and sort run here, in the browser, over every row the page sent; nothing about them is in the URL.
 * The list opens sorted by name, ascending (`OPENING_SORT`).
 */
export function MembersList({ rows, text, language }: { rows: Subscriber[]; text: MembersListText; language: Language }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(OPENING_SORT);
  const shown = sortSubscribers(filterSubscribers(rows, query), sort);
  /** The row's name, linking to its member page. */
  const nameOf = (row: Subscriber) => <TextLink href={adminMemberPath(row.subscriptionId)}>{subscriberName(row)}</TextLink>;
  /** The row's status badge, with "Refund owed" beside it when one is owed. */
  const statusOf = (row: Subscriber) => <SubscriptionStatus status={row.status} refundOwed={row.refundOwed} words={{ status: text.status[row.status], refundOwed: text.refundOwed }} />;

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
      <SearchField
        id={SEARCH_ID}
        label={text.search}
        placeholder={text.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <DataTable
        columns={[header("name", "name"), header("email"), header("phone"), header("meal", "meal"), header("joined", "joined"), header("status", "status")]}
        rows={shown.map((row) => ({
          id: row.subscriptionId,
          cells: [
            nameOf(row),
            row.email,
            row.phone ?? "",
            mealLabel(row.options),
            formatShortDate(row.joinedDate, language),
            statusOf(row),
          ],
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
        rows={shown.map((row) => ({
          id: row.subscriptionId,
          title: nameOf(row),
          badge: statusOf(row),
          detail: fill(text.joinedLine, { meal: mealLabel(row.options), date: formatShortDate(row.joinedDate, language) }),
          note: [row.email, row.phone].filter(Boolean).join(" · "),
        }))}
      />
      {shown.length === 0 && <Hint>{fill(text.noMatch, { q: query })}</Hint>}
    </>
  );
}
