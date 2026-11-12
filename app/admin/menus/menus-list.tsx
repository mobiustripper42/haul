"use client";

// Issue 140: the library's search box and rows.
import { useState } from "react";
import { filterMenus, menuLine, type Menu } from "@core/menus.js";
import { Button } from "../../../components/ui/button";
import { Hint } from "../../../components/ui/hint";
import { SearchField } from "../../../components/ui/search-field";
import { fill } from "../../fill";
import { adminMenuPath, duplicateMenuPath } from "../../paths";

/** The words the page translates for the list. `noMatch` holds `{q}`, filled here as the admin types. */
export type MenusListText = { search: string; searchPlaceholder: string; noMatch: string; edit: string; duplicate: string };

const SEARCH_ID = "menus-search";

/**
 * The library's search box and one row per menu: its name, the first menu option's text on one line, the weeks it is
 * on, Edit and Duplicate. Search runs here, in the browser, over every menu the page sent (`filterMenus`); nothing
 * about it is in the URL. `menus` is in the order shown, `firstOption` the id of the option whose text each row shows,
 * `assigned` the "Assigned to …" line by menu id, and `query` what the box opens holding.
 */
export function MenusList({
  menus,
  firstOption,
  assigned,
  text,
  query: opening = "",
}: {
  menus: Menu[];
  firstOption: string | null;
  assigned: Record<string, string>;
  text: MenusListText;
  query?: string;
}) {
  const [query, setQuery] = useState(opening);
  const shown = filterMenus(menus, query);
  return (
    <>
      <SearchField id={SEARCH_ID} label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul className="flex flex-col">
        {shown.map((menu) => {
          const line = firstOption === null ? "" : menuLine(menu.texts[firstOption] ?? "");
          return (
            <li key={menu.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-divider py-4 first:border-t-0">
              <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                <span className="font-semibold">{menu.name}</span>
                {line !== "" && <Hint>{line}</Hint>}
                <Hint>{assigned[menu.id] ?? ""}</Hint>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 lg:ml-auto">
                <Button kind="quiet" href={adminMenuPath(menu.id)}>
                  {text.edit}
                </Button>
                <Button kind="quiet" href={duplicateMenuPath(menu.id)}>
                  {text.duplicate}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <Hint>{fill(text.noMatch, { q: query })}</Hint>}
    </>
  );
}
