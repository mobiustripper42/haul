import { pluralKey, type Language, type Translator } from "@core/i18n.js";
import { cutoffDate, formatPickupDate, pickupWeek, weekTitle, type AdminWeek } from "@core/pickup-week.js";
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
import { Shell } from "../../../components/ui/shell";
import { Textarea } from "../../../components/ui/textarea";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { ADMIN_WEEKS_PATH } from "../../paths";
import { getRepository } from "../../services";
import { requireAdmin } from "../../session";
import { SiteHeader } from "../../site-header";
import { AdminNav } from "../admin-nav";
import { closeWeek, moveWeek, reopenWeek, saveWeekNote } from "./actions";
import { loadCalendar } from "./calendar";

export const generateMetadata = titled("admin.weeks.title");

type Query = Record<string, string | string[] | undefined>;
type Counts = Map<string, { paid: number; weekCredits: number }>;

/** What the screen needs to word a week, so a row or a dialog is given one thing rather than five. */
type Wording = { t: Translator; language: Language; product: ProductWithOptions; counts: Counts };

const FAULTS = ["beforeCutoff", "order", "overlapsNext"] as const;
type Fault = (typeof FAULTS)[number];

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** A link back to this screen with one panel asked for: the URL says which dialog or panel is open. */
const panelHref = (name: "close" | "reopen" | "note" | "move", weekOf: string): string => `${ADMIN_WEEKS_PATH}?${new URLSearchParams({ [name]: weekOf })}`;

/** The Sunday after `weekOf`, for the next week's cutoff date. */
const nextSunday = (weekOf: string): string => new Date(Date.parse(`${weekOf}T00:00:00Z`) + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** "Monday, January 18": the date a week's cutoff falls on, as the screen words it. */
const cutoffWords = ({ product, language }: Wording, week: AdminWeek): string => formatPickupDate(cutoffDate(product, week.weekOf), language);

/** A week's title. A closed week has no pickup, so it carries its ordinary days: its move, if any, waits for a reopen. */
const titleOf = ({ t, language }: Wording, week: AdminWeek): string =>
  weekTitle(t, week.closedAt === null ? week : pickupWeek(week.weekOf, null), language);

/** Closing an open week: who it gives week credits to, before or after the cutoff, and a note for admins. */
function CloseDialog({ week, wording }: { week: AdminWeek; wording: Wording }) {
  const { t, language, counts } = wording;
  const paid = counts.get(week.weekOf)?.paid ?? 0;
  const cutoff = cutoffWords(wording, week);
  const text = week.cutoffPassed
    ? t(pluralKey(language, "admin.weeks.closeAfter", paid), { n: paid, cutoff })
    : paid === 0
      ? t("admin.weeks.closeNobody", { cutoff })
      : t(pluralKey(language, "admin.weeks.closeBefore", paid), { n: paid, cutoff });
  const confirm = week.cutoffPassed
    ? t("admin.weeks.closeConfirmAfter")
    : paid === 0
      ? t("admin.weeks.closeConfirm")
      : t(pluralKey(language, "admin.weeks.closeConfirmBefore", paid), { n: paid });
  return (
    <Card width="fill">
      <Heading level={2}>{t("admin.weeks.closeHeading", { days: titleOf(wording, week) })}</Heading>
      <p>{text}</p>
      <form action={closeWeek} className="flex flex-col gap-5">
        <input type="hidden" name="week" value={week.weekOf} />
        <Field label={t("admin.weeks.closeNote")} htmlFor="close-note" help={t("admin.weeks.closeNoteHelp")}>
          <Textarea id="close-note" name="note" aria-describedby="close-note-help" />
        </Field>
        <ButtonRow>
          <Button kind="primary" type="submit">
            {confirm}
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
      <Heading level={2}>{t("admin.weeks.reopenHeading", { days: titleOf(wording, week) })}</Heading>
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

/** A closed week's note, in its row: save, clear (a form of its own, posting no text) or cancel. */
function NotePanel({ week, wording }: { week: AdminWeek; wording: Wording }) {
  const { t } = wording;
  const id = `note-${week.weekOf}`;
  const form = `${id}-form`;
  return (
    <div className="flex basis-full flex-col gap-3 rounded-md border border-divider bg-surface-alt p-4">
      <Field label={t("admin.weeks.noteLabel")} htmlFor={id} help={t("admin.weeks.noteHelp")}>
        <Textarea id={id} name="note" form={form} defaultValue={week.note ?? ""} aria-describedby={`${id}-help`} />
      </Field>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <form id={form} action={saveWeekNote}>
          <input type="hidden" name="week" value={week.weekOf} />
          <Button kind="primary" type="submit">
            {t("admin.weeks.saveNote")}
          </Button>
        </form>
        {week.note !== null && (
          <form action={saveWeekNote}>
            <input type="hidden" name="week" value={week.weekOf} />
            <input type="hidden" name="note" value="" />
            <Button kind="secondary" type="submit">
              {t("admin.weeks.clearNote")}
            </Button>
          </form>
        )}
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
  const fault = FAULTS.find((known): known is Fault => known === one(query.error));
  const first = fault ? (one(query.first) ?? week.firstDay) : week.firstDay;
  const last = fault ? (one(query.last) ?? week.lastDay) : week.lastDay;
  const firstId = `first-${week.weekOf}`;
  const lastId = `last-${week.weekOf}`;
  const nextCutoff = formatPickupDate(cutoffDate(product, nextSunday(week.weekOf)), language);
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
        <div className="max-w-xs flex-1 basis-48">
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
        <div className="max-w-xs flex-1 basis-48">
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
  const { t, language, counts } = wording;
  const closed = week.closedAt !== null;
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
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-divider py-4 first:border-t-0">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-semibold">{titleOf(wording, week)}</span>
          {closed && <Badge kind="closed">{t("admin.weeks.badgeClosed")}</Badge>}
          {showMove && <Badge kind="moved">{t("admin.weeks.badgeMoved")}</Badge>}
          {week.note !== null && <Badge kind="note">{t("admin.weeks.badgeNote")}</Badge>}
        </div>
        {showMove && <Hint>{t("admin.weeks.movedFrom", { days: weekTitle(t, pickupWeek(week.weekOf, null), language) })}</Hint>}
        <Hint>{cutoffLine}</Hint>
        {closedLine !== null && <Hint>{closedLine}</Hint>}
        {week.note !== null && <p className="mt-1 max-w-xl rounded-sm bg-surface-alt px-3 py-2">{t("admin.weeks.noteLine", { note: week.note })}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {!closed && (
          <Button kind="quiet" href={panelHref("move", week.weekOf)}>
            {t("admin.weeks.moveDays")}
          </Button>
        )}
        {showMove && (
          <form action={moveWeek}>
            <input type="hidden" name="week" value={week.weekOf} />
            <input type="hidden" name="putBack" value="1" />
            <Button kind="quiet" type="submit">
              {t("admin.weeks.putBack")}
            </Button>
          </form>
        )}
        {closed && (
          <Button kind="quiet" href={panelHref("note", week.weekOf)}>
            {week.note === null ? t("admin.weeks.addNote") : t("admin.weeks.editNote")}
          </Button>
        )}
        {!closed && (
          <Button kind="secondary" href={panelHref("close", week.weekOf)}>
            {t("admin.weeks.closeWeek")}
          </Button>
        )}
        {week.canReopen && (
          <Button kind="secondary" href={panelHref("reopen", week.weekOf)}>
            {t("admin.weeks.reopen")}
          </Button>
        )}
      </div>
      {closed && one(query.note) === week.weekOf && <NotePanel week={week} wording={wording} />}
      {!closed && one(query.move) === week.weekOf && <MovePanel week={week} wording={wording} query={query} />}
    </li>
  );
}

/**
 * The admin's calendar (docs/SPEC.md §7.2): the product's next 12 weeks, where a week is closed with a note,
 * reopened until its cutoff, or has its pickup days moved. Which dialog or panel is open comes from the URL, and
 * each form posts to an action in ./actions.ts, so the screen runs no client script and the back button closes a panel.
 */
export default async function AdminWeeks({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();
  const [t, language, query] = await Promise.all([getTranslator(), getLanguage(), searchParams]);
  const repo = getRepository();
  const { product, weeks } = await loadCalendar(repo, new Date());
  const counts = await repo.listWeekCounts(product.id, weeks[0]?.weekOf ?? product.firstPickupDate);
  const wording: Wording = { t, language, product, counts };
  const closing = weeks.find((week) => week.weekOf === one(query.close) && week.closedAt === null);
  const reopening = weeks.find((week) => week.weekOf === one(query.reopen) && week.canReopen);

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {await AdminNav({ current: "weeks" })}
          <div className="flex flex-col gap-1">
            <Heading>{t("admin.weeks.title")}</Heading>
            <Hint>{t("admin.weeks.hint")}</Hint>
          </div>
          {closing && <CloseDialog week={closing} wording={wording} />}
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
