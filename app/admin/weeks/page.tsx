import { pluralKey, type Language, type Translator } from "@core/i18n.js";
import type { Menu } from "@core/menus.js";
import { cutoffDate, formatPickupDate, isDate, listedWeekTitle, nextCutoffDate, pickupWeek, weekTitle, type AdminWeek } from "@core/pickup-week.js";
import type { ProductWithOptions } from "@core/products.js";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ButtonRow } from "../../../components/ui/button-row";
import { Card } from "../../../components/ui/card";
import { Field } from "../../../components/ui/field";
import { FieldError } from "../../../components/ui/field-error";
import { Heading } from "../../../components/ui/heading";
import { Hint } from "../../../components/ui/hint";
import { Input } from "../../../components/ui/input";
import { RowActions, type RowAction } from "../../../components/ui/row-actions";
import { Shell } from "../../../components/ui/shell";
import { Textarea } from "../../../components/ui/textarea";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ADMIN_WEEKS_PATH } from "../../paths";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { SiteHeader } from "../../site-header";
import { closeWeek, moveWeek, reopenWeek, saveWeekNote } from "./actions";
import { loadCalendar } from "./calendar";
import { MenuPanel } from "./menu-panel";
import { OPEN_PANEL } from "./open-panel";

export const generateMetadata = titled("admin.weeks.title");

type Query = Record<string, string | string[] | undefined>;
type Counts = Map<string, { paid: number; weekCredits: number }>;

/** What the screen needs to word a week, so a row or a dialog is given one thing rather than six. `weekMenus` is week key → menu id. */
type Wording = { t: Translator; language: Language; product: ProductWithOptions; counts: Counts; menus: Menu[]; weekMenus: Map<string, string> };

const FAULTS = ["beforeCutoff", "order", "overlapsNext"] as const;
type Fault = (typeof FAULTS)[number];

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * A link back to this screen with one panel asked for: the URL says which dialog or panel is open. A panel in a week's
 * row also carries the fragment, so the page lands on that week's row (issue 230); Close week and Reopen open at the top.
 */
const panelHref = (name: "close" | "reopen" | "note" | "move" | "menu", weekOf: string): string =>
  `${ADMIN_WEEKS_PATH}?${new URLSearchParams({ [name]: weekOf })}${name === "close" || name === "reopen" ? "" : `#${OPEN_PANEL}`}`;

/** "Monday, January 18": the date a week's cutoff falls on, as the screen words it. */
const cutoffWords = ({ product, language }: Wording, week: AdminWeek): string => formatPickupDate(cutoffDate(product, week.weekOf), language);

/** Closing an open week: who it gives week credits to, before or after the cutoff, how many members are emailed, and a note to the members it emails, which starts as the week's own. */
function CloseDialog({ week, wording, emailed }: { week: AdminWeek; wording: Wording; emailed: number }) {
  const { t, language, counts } = wording;
  const paid = counts.get(week.weekOf)?.paid ?? 0;
  const cutoff = cutoffWords(wording, week);
  const text = week.cutoffPassed
    ? t(pluralKey(language, "admin.weeks.closeAfter", paid), { n: paid, cutoff })
    : paid === 0
      ? t("admin.weeks.closeNobody", { cutoff })
      : t(pluralKey(language, "admin.weeks.closeBefore", paid), { n: paid, cutoff });
  const emailText = emailed === 0 ? t("admin.weeks.closeEmailsNone") : t(pluralKey(language, "admin.weeks.closeEmails", emailed), { n: emailed });
  return (
    <Card width="fill">
      <Heading level={2}>{t("admin.weeks.closeHeading", { days: listedWeekTitle(t, week, language) })}</Heading>
      <p>
        {text} {emailText}
      </p>
      <form action={closeWeek} className="flex flex-col gap-5">
        <input type="hidden" name="week" value={week.weekOf} />
        <Field label={t("admin.weeks.closeNote")} htmlFor="close-note" help={t("admin.weeks.closeNoteHelp")}>
          <Textarea id="close-note" name="note" defaultValue={week.note ?? ""} aria-describedby="close-note-help" />
        </Field>
        <ButtonRow>
          <Button kind="primary" type="submit">
            {t("admin.weeks.closeConfirm")}
          </Button>
          <Button kind="quiet" href={ADMIN_WEEKS_PATH}>
            {t("admin.weeks.keepOpen")}
          </Button>
        </ButtonRow>
      </form>
    </Card>
  );
}

/** Reopening a week closed before its cutoff: the week credits that closing gave are taken back. */
function ReopenDialog({ week, wording }: { week: AdminWeek; wording: Wording }) {
  const { t, language, counts } = wording;
  const given = counts.get(week.weekOf)?.weekCredits ?? 0;
  return (
    <Card width="fill">
      <Heading level={2}>{t("admin.weeks.reopenHeading", { days: listedWeekTitle(t, week, language) })}</Heading>
      <p>
        {given === 0 ? t("admin.weeks.reopenGaveNone") : t(pluralKey(language, "admin.weeks.reopenGave", given), { n: given })}{" "}
        {t("admin.weeks.reopenCharged", { cutoff: cutoffWords(wording, week) })}
      </p>
      <form action={reopenWeek} className="flex flex-col gap-5">
        <input type="hidden" name="week" value={week.weekOf} />
        <ButtonRow>
          <Button kind="primary" type="submit">
            {t("admin.weeks.reopenConfirm")}
          </Button>
          <Button kind="quiet" href={ADMIN_WEEKS_PATH}>
            {t("admin.weeks.keepClosed")}
          </Button>
        </ButtonRow>
      </form>
    </Card>
  );
}

/** A week's note to members, in its row, until its cutoff: save or cancel. Saving an empty field clears the note. */
function NotePanel({ week, wording }: { week: AdminWeek; wording: Wording }) {
  const { t } = wording;
  const id = `note-${week.weekOf}`;
  const form = `${id}-form`;
  return (
    <div className="flex basis-full flex-col gap-3 rounded-md border border-divider bg-surface-alt p-4">
      <Field label={t("admin.weeks.noteLabel")} htmlFor={id} help={t("admin.weeks.noteHelp")}>
        <Textarea id={id} name="note" form={form} rows={4} defaultValue={week.note ?? ""} aria-describedby={`${id}-help`} />
      </Field>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <form id={form} action={saveWeekNote}>
          <input type="hidden" name="week" value={week.weekOf} />
          <Button kind="primary" type="submit">
            {t("admin.weeks.saveNote")}
          </Button>
        </form>
        <Button kind="quiet" href={ADMIN_WEEKS_PATH}>
          {t("admin.weeks.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** An open week's days, in its row. After a refused move the dates entered come back, with the fault under the day at fault. */
function MovePanel({ week, wording, query }: { week: AdminWeek; wording: Wording; query: Query }) {
  const { t, language, product } = wording;
  // moveWeek sends a fault back with two real dates, so a query with anything else was typed by hand and is ignored whole.
  const entered = one(query.first) ?? "";
  const enteredLast = one(query.last) ?? "";
  const refused = isDate(entered) && isDate(enteredLast);
  const fault = refused ? FAULTS.find((known): known is Fault => known === one(query.error)) : undefined;
  const first = fault ? entered : week.firstDay;
  const last = fault ? enteredLast : week.lastDay;
  const firstId = `first-${week.weekOf}`;
  const lastId = `last-${week.weekOf}`;
  const nextCutoff = formatPickupDate(nextCutoffDate(product, week.weekOf), language);
  const faultText =
    fault === "beforeCutoff"
      ? t("admin.weeks.errorBeforeCutoff", { cutoff: cutoffWords(wording, week) })
      : fault === "order"
        ? t("admin.weeks.errorOrder")
        : fault === "overlapsNext"
          ? t("admin.weeks.errorOverlapsNext", { day: formatPickupDate(last, language), cutoff: nextCutoff })
          : null;
  const firstBad = fault === "beforeCutoff";
  const lastBad = fault === "order" || fault === "overlapsNext";
  return (
    <form action={moveWeek} className="flex basis-full flex-col gap-4 rounded-md border border-divider bg-surface-alt p-4">
      <input type="hidden" name="week" value={week.weekOf} />
      <Heading level={2}>{t("admin.weeks.moveHeading")}</Heading>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <div className="max-w-card flex-1 basis-48">
          <Field label={t("admin.weeks.firstDay")} htmlFor={firstId}>
            <Input
              id={firstId}
              name="firstDay"
              type="date"
              required
              defaultValue={first}
              aria-invalid={firstBad || undefined}
              aria-describedby={firstBad ? `${firstId}-error` : undefined}
            />
            {firstBad && <FieldError id={`${firstId}-error`}>{faultText}</FieldError>}
          </Field>
        </div>
        <div className="max-w-card flex-1 basis-48">
          <Field label={t("admin.weeks.lastDay")} htmlFor={lastId} help={t("admin.weeks.lastDayHelp")}>
            <Input
              id={lastId}
              name="lastDay"
              type="date"
              required
              defaultValue={last}
              aria-invalid={lastBad || undefined}
              aria-describedby={lastBad ? `${lastId}-error ${lastId}-help` : `${lastId}-help`}
            />
            {lastBad && <FieldError id={`${lastId}-error`}>{faultText}</FieldError>}
          </Field>
        </div>
      </div>
      <Hint>{t("admin.weeks.cutoffStays", { cutoff: cutoffWords(wording, week) })}</Hint>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <Button kind="primary" type="submit">
          {t("admin.weeks.saveDays")}
        </Button>
        <Button kind="quiet" href={ADMIN_WEEKS_PATH}>
          {t("admin.weeks.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** One week: its days, badges, cutoff and what closing gave, then its actions and whichever panel the URL opened. */
function WeekRow({ week, wording, query }: { week: AdminWeek; wording: Wording; query: Query }) {
  const { t, language, counts, menus, weekMenus } = wording;
  const closed = week.closedAt !== null;
  const menuName = menus.find((menu) => menu.id === weekMenus.get(week.weekOf))?.name ?? null;
  const { paid, weekCredits } = counts.get(week.weekOf) ?? { paid: 0, weekCredits: 0 };
  const cutoff = cutoffWords(wording, week);
  const cutoffLine = !week.cutoffPassed
    ? t("admin.weeks.cutoff", { cutoff })
    : closed
      ? t("admin.weeks.cutoffPassed", { cutoff })
      : t("admin.weeks.cutoffPassedCharged", { cutoff, n: paid });
  const closedAfterCutoff = week.closedAt !== null && week.closedAt.getTime() >= week.cutoff.getTime();
  const closedLine = closedAfterCutoff
    ? t(pluralKey(language, "admin.weeks.closedAfter", weekCredits), { n: weekCredits })
    : closed && weekCredits > 0
      ? t(pluralKey(language, "admin.weeks.creditsGiven", weekCredits), { n: weekCredits })
      : null;
  const showMove = week.moved && !closed;
  const title = listedWeekTitle(t, week, language);
  const menuAction: RowAction = { label: menuName === null ? t("admin.weeks.assignMenu") : t("admin.weeks.changeMenu"), href: panelHref("menu", week.weekOf) };
  const moveAction: RowAction = { label: t("admin.weeks.moveDays"), href: panelHref("move", week.weekOf) };
  const putBackAction: RowAction = { label: t("admin.weeks.putBack"), action: moveWeek, fields: { week: week.weekOf, putBack: "1" } };
  const closeAction: RowAction = { label: t("admin.weeks.closeWeek"), href: panelHref("close", week.weekOf) };
  const reopenAction: RowAction = { label: t("admin.weeks.reopen"), href: panelHref("reopen", week.weekOf) };
  const noteAction: RowAction = { label: week.note === null ? t("admin.weeks.addNote") : t("admin.weeks.editNote"), href: panelHref("note", week.weekOf) };
  // A note is taken until the cutoff passes, on an open week or a closed one; RowActions draws nothing for a row with no action.
  const noteActions = week.cutoffPassed ? [] : [noteAction];
  const { main, others }: { main?: RowAction; others: RowAction[] } = !closed
    ? { main: menuAction, others: [moveAction, ...(showMove ? [putBackAction] : []), closeAction, ...noteActions] }
    : week.canReopen
      ? { main: reopenAction, others: noteActions }
      : { others: noteActions };
  const noteOpen = !week.cutoffPassed && one(query.note) === week.weekOf;
  const menuOpen = !closed && one(query.menu) === week.weekOf;
  const moveOpen = !closed && one(query.move) === week.weekOf;
  // Issue 230: the row with an open panel carries the fragment's id, so the page lands on its title, the panel below it.
  return (
    <li
      id={noteOpen || menuOpen || moveOpen ? OPEN_PANEL : undefined}
      className="flex scroll-mt-4 flex-wrap items-start gap-x-4 gap-y-2 border-t border-divider py-4 first:border-t-0"
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-semibold">{title}</span>
          {closed && <Badge kind="closed">{t("admin.weeks.badgeClosed")}</Badge>}
          {showMove && <Badge kind="moved">{t("admin.weeks.badgeMoved")}</Badge>}
          {week.note !== null && <Badge kind="note">{t("admin.weeks.badgeNote")}</Badge>}
        </div>
        {showMove && <Hint>{t("admin.weeks.movedFrom", { days: weekTitle(t, pickupWeek(week.weekOf, null), language) })}</Hint>}
        <Hint>{cutoffLine}</Hint>
        {!closed && (menuName !== null ? <Hint>{t("admin.weeks.menuLine", { name: menuName })}</Hint> : <Hint danger>{t("admin.weeks.noMenuYet")}</Hint>)}
        {closedLine !== null && <Hint>{closedLine}</Hint>}
        {week.note !== null && <p className="mt-1 max-w-xl rounded-sm bg-surface-alt px-3 py-2">{t("admin.weeks.noteLine", { note: week.note })}</p>}
      </div>
      <div className="ml-auto flex justify-end">
        <RowActions main={main} others={others} moreLabel={t("rowActions.more")} moreName={t("rowActions.moreFor", { week: title })} />
      </div>
      {noteOpen && <NotePanel week={week} wording={wording} />}
      {menuOpen && <MenuPanel week={week} t={t} language={language} menus={menus} current={weekMenus.get(week.weekOf) ?? null} />}
      {moveOpen && <MovePanel week={week} wording={wording} query={query} />}
    </li>
  );
}

/**
 * The admin's calendar (docs/SPEC.md §7.2): the product's next 12 weeks, where a week is closed with a note to
 * members, reopened until its cutoff, given a note, or has its pickup days moved. Which dialog or panel is open comes from the URL, and
 * each form posts to an action in ./actions.ts, so the screen runs no client script and the back button closes a panel.
 */
export default async function AdminWeeks({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();
  const [t, language, query] = await Promise.all([getTranslator(), getLanguage(), searchParams]);
  const repo = getRepository();
  const { product, weeks, menus: weekMenus } = await loadCalendar(repo, new Date());
  const [counts, menus] = await Promise.all([repo.listWeekCounts(product.id, weeks[0]?.weekOf ?? product.firstPickupDate), repo.listMenus()]);
  const wording: Wording = { t, language, product, counts, menus, weekMenus };
  const closing = weeks.find((week) => week.weekOf === one(query.close) && week.closedAt === null);
  const reopening = weeks.find((week) => week.weekOf === one(query.reopen) && week.canReopen);
  // The close action emails whoever listWeekDue gives, so the dialog counts the same query, only for the week it is open on.
  const emailed = closing ? (await repo.listWeekDue(product.id, closing.weekOf, closing.cutoff)).length : 0;

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin-weeks" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          <div className="flex flex-col gap-1">
            <Heading>{t("admin.weeks.title")}</Heading>
            <Hint>{t("admin.weeks.hint")}</Hint>
          </div>
          {closing && <CloseDialog week={closing} wording={wording} emailed={emailed} />}
          {reopening && <ReopenDialog week={reopening} wording={wording} />}
          <Card width="fill">
            <ul aria-label={t("admin.weeks.upcoming")} className="flex flex-col">
              {weeks.map((week) => (
                <WeekRow key={week.weekOf} week={week} wording={wording} query={query} />
              ))}
            </ul>
          </Card>
        </div>
      </Shell>
    </>
  );
}
