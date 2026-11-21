import type { ReactNode } from "react";

/**
 * The signed-in header's Admin ▾ group at 1024px and wider (issue 159): a `<details>` whose `<summary>` is
 * `label` and whose panel holds `children`. `active` marks the summary (`data-active`) when the page showing is one
 * of its links. `MenuScript` closes it on an outside click, focus moving outside it, or Escape; the panel is `MenuButton`'s, which this
 * replaced.
 *
 * `look` is how the summary is drawn: `"header"` (the default) is a menu row beside a divider; `"button"` is a
 * secondary button with the same chevron and no divider, for a row's More (issue 220). `name` is the summary's
 * `aria-label` when it needs one apart from its text.
 */
export function MenuGroup({
  label,
  active,
  look = "header",
  name,
  children,
}: {
  label: string;
  active: boolean;
  look?: "header" | "button";
  name?: string;
  children: ReactNode;
}) {
  const button = look === "button";
  return (
    <details data-menu-group className={button ? "relative" : "menu-group"}>
      <summary className={button ? "btn-secondary menu-chevron" : "menu-group-summary"} data-active={active ? "" : undefined} aria-label={name}>
        {label}
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 flex w-64 flex-col gap-2 rounded-md bg-surface p-4 shadow-modal">{children}</div>
    </details>
  );
}
