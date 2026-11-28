import type { ComponentProps } from "react";

/**
 * A divided list's row (issue 262): an `<li>` with `.list-row`, a hairline above every row but the first and a row's
 * space between, none above the first row or below the last. The caller's `className` adds the row's layout, and a
 * row that must keep the first row's border and padding says so there (`RowList`).
 */
export function ListRow({ className, ...rest }: ComponentProps<"li">) {
  return <li {...rest} className={className ? `list-row ${className}` : "list-row"} />;
}
