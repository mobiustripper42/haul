import { createTranslator, type Language, type Translator } from "./i18n.js";
import { noteBlock, renderEmail, type EmailTemplates } from "./email-templates.js";
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
import { MISSING_MENU_DAYS_DEFAULT, MISSING_MENU_DAYS_KEY, MISSING_NOTE_DAYS_DEFAULT, MISSING_NOTE_DAYS_KEY, wholeNumberSetting } from "./settings.js";

/**
 * The menu run (issue 141, DEC-036; DEC-003). Each firing does two jobs, each logging its own failures and never
 * stopping the other. The menu email: once the current week has a menu, on or after its email day, every member holding a
 * `paid` or `declined` ledger row for it, whose preference is on, gets the menu, and the week's menu row is stamped sent,
 * so a second firing sends nothing and the public page flips. The week's note, when it has one, heads the email (issue
 * 231). The two reminders: while an open week whose first pickup day is within `missing_menu_days` has no menu, or within
 * `missing_note_days` has no note, every admin is emailed once a Cleveland day for each, which an audit event records.
 * Both days are `settings` rows (src/settings.ts). Every write runs under `MENU_RUN_ACTOR`.
 */

export type MenuRunDeps = {
  repo: Repository;
  email: EmailPort;
  now: Date;
  siteUrl: string;
  accountWeeksUrl: string;
  adminWeeksUrl: string;
  emailWeekday: number;
  sessionSecret: string;
};

/**
 * `menuEmail.weekOf` is the current week's key, null only when there is none; `sent` counts the members' emails sent.
 * `reminder.weeks` lists the qualifying weeks on every firing; `sent` counts the admins' emails sent. `noteReminder` is
 * the same for the weeks with no note (issue 231).
 */
export type MenuRunReport = {
  menuEmail: { weekOf: string | null; sent: number };
  reminder: { weeks: string[]; sent: number };
  noteReminder: { weeks: string[]; sent: number };
};

export const MENU_RUN_ACTOR: Actor = { system: "menu-run" };

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

/** Fires the menu email, then the two reminders. */
export async function runMenuRun(deps: MenuRunDeps): Promise<MenuRunReport> {
  const product = await requireSupperClub(deps.repo);
  const report: MenuRunReport = { menuEmail: { weekOf: null, sent: 0 }, reminder: { weeks: [], sent: 0 }, noteReminder: { weeks: [], sent: 0 } };
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
  try {
    await sendMissingNoteReminder(deps, product, report.noteReminder);
  } catch (error) {
    logFailure("note reminder", error);
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
      note: noteBlock(week.note === null ? null : t("email.menu.note", { note: week.note }), "above"),
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
 * The open weeks whose first pickup day, moved or not, is from today to `days` days on, both ends included, that `lacks`
 * says are missing what the reminder is about: the one window both reminders share.
 */
async function reminderWeeks(
  deps: MenuRunDeps,
  product: ProductWithOptions,
  days: number,
  lacks: (week: AdminWeek) => Promise<boolean>,
): Promise<AdminWeek[]> {
  const { repo, now } = deps;
  const today = clevelandDate(now);
  const last = addDays(today, days);
  const weeks: AdminWeek[] = [];
  for (const week of upcomingWeeks(product, now, await repo.listChangedWeeks(product.id, product.firstPickupDate))) {
    if (week.closedAt === null && week.firstDay >= today && week.firstDay <= last && (await lacks(week))) weeks.push(week);
  }
  return weeks;
}

/**
 * The reminder to every admin, once a Cleveland day: `template` filled by `values` with the weeks' titles in the admin's
 * language, then `kind`'s event recorded for them. Which day an admin was told is the event on their member row
 * (`detail.date`), so a by-hand run with `--now` is as idempotent as the clock's. Returns the emails sent.
 */
async function remindAdmins<N extends "missingMenu" | "missingNote">(
  deps: MenuRunDeps,
  reminder: {
    template: N;
    weeks: AdminWeek[];
    kind: "menu_reminder_sent" | "note_reminder_sent";
    values: (t: Translator, language: Language, weeks: string) => EmailTemplates[N];
  },
): Promise<number> {
  const { repo, now } = deps;
  const { template, weeks, kind, values } = reminder;
  const today = clevelandDate(now);
  if (weeks.length === 0 || (await repo.hasEventOn(kind, today))) return 0;

  let sent = 0;
  for (const admin of await repo.listAdmins()) {
    try {
      const language: Language = admin.language;
      const t = createTranslator(language);
      const titles = weeks.map((week) => weekTitle(t, week, language)).join(SEPARATOR);
      const message = renderEmail(template, language, values(t, language, titles), deps.siteUrl);
      await deps.email.send({ to: admin.email, subject: message.subject, text: message.text });
      sent++;
      await recordEventAs(repo, MENU_RUN_ACTOR, { kind, memberId: admin.id, detail: { weeks: weeks.map((week) => week.weekOf), date: today } });
    } catch (error) {
      logFailure("admin email", error);
    }
  }
  return sent;
}

/** The reminder that an open week within `missing_menu_days` has no menu. */
async function sendMissingMenuReminder(deps: MenuRunDeps, product: ProductWithOptions, report: MenuRunReport["reminder"]): Promise<void> {
  const days = await wholeNumberSetting(deps.repo, MISSING_MENU_DAYS_KEY, MISSING_MENU_DAYS_DEFAULT);
  const weeks = await reminderWeeks(deps, product, days, async (week) => (await deps.repo.findWeekMenu(product.id, week.weekOf)) === null);
  report.weeks = weeks.map((week) => week.weekOf);
  report.sent = await remindAdmins(deps, {
    template: "missingMenu",
    weeks,
    kind: "menu_reminder_sent",
    values: (_t, language, titles) => ({
      weeks: titles,
      weekday: weekdayName(addDays(A_SUNDAY, deps.emailWeekday), language),
      link: deps.adminWeeksUrl,
    }),
  });
}

/** The reminder that an open week within `missing_note_days` has no note (issue 231). */
async function sendMissingNoteReminder(deps: MenuRunDeps, product: ProductWithOptions, report: MenuRunReport["noteReminder"]): Promise<void> {
  const days = await wholeNumberSetting(deps.repo, MISSING_NOTE_DAYS_KEY, MISSING_NOTE_DAYS_DEFAULT);
  const weeks = await reminderWeeks(deps, product, days, async (week) => week.note === null);
  report.weeks = weeks.map((week) => week.weekOf);
  report.sent = await remindAdmins(deps, {
    template: "missingNote",
    weeks,
    kind: "note_reminder_sent",
    values: (_t, _language, titles) => ({ weeks: titles, link: deps.adminWeeksUrl }),
  });
}
