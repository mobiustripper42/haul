// Issue 140: the "Assigned to …" line, one home for the list page and the editor.
import type { Language, Translator } from "@core/i18n.js";
import { SEPARATOR } from "@core/member-list.js";
import { assignedWeeks } from "@core/menus.js";
import { listedWeekTitle } from "@core/pickup-week.js";
import type { Calendar } from "../weeks/calendar";

/** "Assigned to {week} · {week}" over the upcoming weeks the menu is on, or "Not assigned to a week". */
export function assignedLine(menuId: string, calendar: Calendar, t: Translator, language: Language): string {
  const weeks = assignedWeeks(menuId, calendar.weeks, calendar.menus);
  if (weeks.length === 0) return t("admin.menus.notAssigned");
  return t("admin.menus.assignedTo", { weeks: weeks.map((week) => listedWeekTitle(t, week, language)).join(SEPARATOR) });
}
