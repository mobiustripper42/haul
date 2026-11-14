import { createTranslator, type Language } from "./i18n.js";
import { renderEmail } from "./email-templates.js";
import { menuEmailOffLink } from "./menu-email-link.js";
import { mealLabel, SEPARATOR } from "./member-list.js";
import type { Member } from "./members.js";
import { menuSections, type Menu } from "./menus.js";
import {
  addDays,
  clevelandDate,
  formatPickupDate,
  menuEmailDate,
  nextCutoffDate,
  nextPickup,
  pickupWhereLine,
  upcomingWeeks,
  weekdayName,
  weekTitle,
  type AdminWeek,
} from "./pickup-week.js";
import type { EmailPort } from "./ports/email.js";
import type { Actor, Repository, WeekMade } from "./ports/repository.js";
import { requireSupperClub, type ProductWithOptions } from "./products.js";
import { errorFields, recordEventAs } from "./record-event.js";

/**
 * The menu run (issue 141, DEC-036; DEC-003). Each firing does two jobs, each logging its own failures and never
 * stopping the other. The menu email: once the current week has a menu, on or after its email day, every member holding a
 * `paid` or `declined` ledger row for it, whose preference is on, gets the menu, and the week's menu row is stamped sent,
 * so a second firing sends nothing and the public page flips. The missing-menu reminder: while an open week whose first
 * pickup day is within `MISSING_MENU_DAYS` has no menu, every admin is emailed once a Cleveland day, which an audit event
 * records. Every write runs under `MENU_RUN_ACTOR`.
 */

export type MenuRunDeps = {
  repo: Repository;
  email: EmailPort;
  now: Date;
  siteUrl: string;
  accountWeeksUrl: string;
  adminWeeksUrl: string;
  menuUrl: string;
  emailWeekday: number;
  sessionSecret: string;
};

/**
 * `menuEmail.weekOf` is the current week's key, null only when there is none; `sent` counts the members' emails sent.
 * `reminder.weeks` lists the qualifying weeks on every firing; `sent` counts the admins' emails sent.
 */
export type MenuRunReport = { menuEmail: { weekOf: string | null; sent: number }; reminder: { weeks: string[]; sent: number } };

export const MENU_RUN_ACTOR: Actor = { system: "menu-run" };

/** An open week counts for the reminder when its first pickup day is no more than this many days after today. */
export const MISSING_MENU_DAYS = 14;

/** A Sunday, from which a weekday number is a date to name it by. */
const A_SUNDAY = "2023-01-01";

/** The email weekday from the env: exactly one digit, 0 to 6, Sunday 0; anything else, or nothing, throws. */
export function menuEmailWeekday(env: { MENU_EMAIL_WEEKDAY?: string }): number {
  const value = env.MENU_EMAIL_WEEKDAY;
  if (value === undefined || !/^[0-6]$/.test(value)) throw new Error("MENU_EMAIL_WEEKDAY must be a weekday number from 0 (Sunday) to 6");
  return Number(value);
}

/**
 * The current week, the earliest listed whose last pickup day has not passed in Cleveland and that is not closed, with
 * the menu on it and when it was emailed. Null when every listed week is closed. The one home the run and the menu page share.
 */
export async function currentWeekMenu(
  repo: Repository,
  product: ProductWithOptions,
  now: Date,
): Promise<{ week: AdminWeek; menu: Menu | null; sentAt: Date | null } | null> {
  const weeks = upcomingWeeks(product, now, await repo.listChangedWeeks(product.id, product.firstPickupDate));
  const first = weeks[0];
  const week = first ? nextPickup(weeks, first.weekOf) : null;
  if (!week) return null;
  const found = await repo.findWeekMenu(product.id, week.weekOf);
  return { week, menu: found?.menu ?? null, sentAt: found?.sentAt ?? null };
}

/** The log line for a failure: the step and the error's name and code, never its message, which can carry the provider's text. */
function logFailure(step: string, error: unknown): void {
  console.error("menu run step failed", { step, ...errorFields(error) });
}

/** Fires the menu email, then the reminder. */
export async function runMenuRun(deps: MenuRunDeps): Promise<MenuRunReport> {
  const product = await requireSupperClub(deps.repo);
  const report: MenuRunReport = { menuEmail: { weekOf: null, sent: 0 }, reminder: { weeks: [], sent: 0 } };
  try {
    await sendMenuEmail(deps, product, report.menuEmail);
  } catch (error) {
    logFailure("menu email", error);
  }
  try {
    await sendMissingMenuReminder(deps, product, report.reminder);
  } catch (error) {
    logFailure("reminder", error);
  }
  return report;
}

/** The members' boxes for the week, grouped by member in the order they first appear: one email each, a meal line per box. */
function byMember(made: WeekMade[]): { member: Member; boxes: WeekMade[] }[] {
  const groups = new Map<string, { member: Member; boxes: WeekMade[] }>();
  for (const box of made) {
    const group = groups.get(box.member.id);
    if (group) group.boxes.push(box);
    else groups.set(box.member.id, { member: box.member, boxes: [box] });
  }
  return [...groups.values()];
}

/** The menu email, when the current week has a menu, its email day has come and it is not yet sent; then the stamp. */
async function sendMenuEmail(deps: MenuRunDeps, product: ProductWithOptions, report: MenuRunReport["menuEmail"]): Promise<void> {
  const { repo, now } = deps;
  const current = await currentWeekMenu(repo, product, now);
  if (!current) return;
  const { week, menu, sentAt } = current;
  report.weekOf = week.weekOf;
  if (!menu || sentAt !== null || clevelandDate(now) < menuEmailDate(product, week.weekOf, deps.emailWeekday)) return;

  for (const { member, boxes } of byMember(await repo.listWeekMade(product.id, week.weekOf))) {
    if (!member.menuEmails) continue;
    try {
      const message = renderMenuEmail(deps, product, week, menu, member, boxes);
      await deps.email.send({ to: member.email, subject: message.subject, text: message.text });
      report.sent++;
    } catch (error) {
      logFailure("member email", error);
    }
  }
  try {
    await repo.withActor(MENU_RUN_ACTOR, (scoped) => scoped.markWeekMenuSent(product.id, week.weekOf, now));
  } catch (error) {
    logFailure("stamp", error);
  }
}

/** The menu email for one member, in their language. */
function renderMenuEmail(
  deps: MenuRunDeps,
  product: ProductWithOptions,
  week: AdminWeek,
  menu: Menu,
  member: Member,
  boxes: WeekMade[],
): { subject: string; text: string } {
  const language: Language = member.language;
  const t = createTranslator(language);
  return renderEmail(
    "menuEmail",
    language,
    {
      heading: t("menu.heading", { week: weekTitle(t, week, language) }),
      menus: menuSections(product, menu)
        .map((section) => [section.name, ...section.lines].join("\n"))
        .join("\n\n"),
      meals: boxes.map((box) => t("email.menu.meal", { picks: mealLabel(box.options) })).join("\n"),
      pickupLine: t("menu.pickup", { pickup: pickupWhereLine(t, week, language) }),
      date: formatPickupDate(nextCutoffDate(product, week.weekOf), language),
      link: deps.accountWeeksUrl,
      offLink: menuEmailOffLink(deps.siteUrl, member.id, deps.sessionSecret),
    },
    deps.siteUrl,
  );
}

/**
 * The reminder to every admin, once a Cleveland day. Which day an admin was told is the event on their member row
 * (`detail.date`), so a by-hand run with `--now` is as idempotent as the clock's.
 */
async function sendMissingMenuReminder(deps: MenuRunDeps, product: ProductWithOptions, report: MenuRunReport["reminder"]): Promise<void> {
  const { repo, now } = deps;
  const today = clevelandDate(now);
  const last = addDays(today, MISSING_MENU_DAYS);
  const weeks: AdminWeek[] = [];
  for (const week of upcomingWeeks(product, now, await repo.listChangedWeeks(product.id, product.firstPickupDate))) {
    if (week.closedAt === null && week.firstDay >= today && week.firstDay <= last && (await repo.findWeekMenu(product.id, week.weekOf)) === null) weeks.push(week);
  }
  report.weeks = weeks.map((week) => week.weekOf);
  if (weeks.length === 0 || (await repo.hasEventOn("menu_reminder_sent", today))) return;

  for (const admin of await repo.listAdmins()) {
    try {
      const language: Language = admin.language;
      const t = createTranslator(language);
      const message = renderEmail(
        "missingMenu",
        language,
        {
          weeks: weeks.map((week) => weekTitle(t, week, language)).join(SEPARATOR),
          weekday: weekdayName(addDays(A_SUNDAY, deps.emailWeekday), language),
          link: deps.adminWeeksUrl,
        },
        deps.siteUrl,
      );
      await deps.email.send({ to: admin.email, subject: message.subject, text: message.text });
      report.sent++;
      await recordEventAs(repo, MENU_RUN_ACTOR, { kind: "menu_reminder_sent", memberId: admin.id, detail: { weeks: report.weeks, date: today } });
    } catch (error) {
      logFailure("admin email", error);
    }
  }
}
