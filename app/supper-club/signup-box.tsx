import type { Language, Translator } from "@core/i18n.js";
import { formatUsdWhole } from "@core/money.js";
import { firstPickupLine, pickupWhereLine } from "@core/pickup-week.js";
import type { SignupConfirmation } from "@core/ports/repository.js";

/**
 * "Your box" and "What happens next", the two parts of the confirmation: one tree, whose parts are cards
 * below `lg` and sections under a hairline in the pane at `lg` and wider, by class, so each string is
 * rendered once.
 */
export function SignupBox({ t, language, confirmation }: { t: Translator; language: Language; confirmation: SignupConfirmation }) {
  const first = formatUsdWhole(confirmation.firstChargeCents);
  const weekly = formatUsdWhole(confirmation.weeklyCents);
  const week = { weekOf: confirmation.pickupDate, firstDay: confirmation.firstDay, lastDay: confirmation.lastDay };
  const label = "text-label text-teal-muted";
  return (
    <>
      <section className="pane-box">
        <p className="font-display text-section text-teal">{t("supperClub.box.title")}</p>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          {confirmation.options.map((option) => (
            <div key={option.typeName} className="flex flex-col gap-0.5">
              <dt className={`${label} uppercase`}>{option.typeName}</dt>
              <dd className="font-semibold">{option.optionName}</dd>
            </div>
          ))}
          <div className="flex flex-col gap-0.5">
            <dt className={`${label} uppercase`}>{t("supperClub.box.paidToday")}</dt>
            <dd className="font-semibold">
              {first} <span className="font-normal text-ink-muted">{t("supperClub.box.firstWeek")}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={`${label} uppercase`}>{t("supperClub.box.then")}</dt>
            <dd className="font-semibold">
              {weekly} <span className="font-normal text-ink-muted">{t("supperClub.box.everyWeek")}</span>
            </dd>
          </div>
        </dl>
        <div className="flex flex-col gap-1 border-t border-divider pt-5">
          <p className="font-semibold">{firstPickupLine(t, week, language)}</p>
          <p>{pickupWhereLine(t, week, language)}</p>
        </div>
      </section>
      <section className="pane-next">
        <p className="font-display text-section text-teal">{t("supperClub.next.title")}</p>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>{t("supperClub.next.menu")}</li>
          <li>{t("supperClub.next.charge", { price: weekly })}</li>
          <li>{t("supperClub.next.change")}</li>
        </ol>
      </section>
    </>
  );
}
