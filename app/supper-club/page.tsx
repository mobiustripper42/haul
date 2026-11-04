import { resolveChoices } from "@core/choices.js";
import { formatUsdWhole } from "@core/money.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "@core/products.js";
import { Button } from "../../components/ui/button";
import { ButtonRow } from "../../components/ui/button-row";
import { Card } from "../../components/ui/card";
import { Eyebrow } from "../../components/ui/eyebrow";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { OptionPicker } from "../../components/ui/option-picker";
import { Panel } from "../../components/ui/panel";
import { Shell } from "../../components/ui/shell";
import { getTranslator } from "../language";
import { getRepository } from "../services";
import { getSignedInMember } from "../session";

const EVERY_WEEK = [
  "supperClub.item.protein",
  "supperClub.item.grain",
  "supperClub.item.veggie",
  "supperClub.item.salad",
  "supperClub.item.soup",
] as const;

/**
 * The Supper Club: the farm's copy, then a card with one picker per option type of the product, so an
 * option type added in data adds a picker. The pickers and both account buttons are one GET form to
 * `/supper-club/continue`, which keeps the choices through sign-in; there is no client script.
 */
export default async function SupperClub({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, query, member] = await Promise.all([getTranslator(), searchParams, getSignedInMember()]);
  const product = await getRepository().findProductByName(SUPPER_CLUB_PRODUCT_NAME);
  if (!product) throw new Error(`The product "${SUPPER_CLUB_PRODUCT_NAME}" is not in the database`);
  const choices = resolveChoices(product, query);

  return (
    <Shell width="page">
      <section className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Eyebrow tone="muted">{t("supperClub.eyebrow")}</Eyebrow>
          <Heading>{t("supperClub.title")}</Heading>
        </div>
        <p>{t("supperClub.intro")}</p>
        <p className="text-ink-muted">{t("supperClub.team")}</p>
        <Card>
          <p className="font-display text-section text-teal">{t("supperClub.everyWeek")}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {EVERY_WEEK.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <Hint>{t("supperClub.allergens")}</Hint>
        </Card>
        <Panel title={t("supperClub.sampleTitle")}>
          <p className="font-semibold text-teal">{t("supperClub.sampleMain")}</p>
          <p>{t("supperClub.sampleSides")}</p>
          <Hint>{t("supperClub.sampleVegan")}</Hint>
        </Panel>
        <p>
          <strong className="font-semibold">{t("supperClub.pickupWhen")}</strong> {t("supperClub.pickupWhere")}
        </p>
      </section>
      <section className="min-w-0 flex-1">
        <Card>
          <p className="font-display text-heading text-teal">{t("supperClub.joinTitle")}</p>
          <form method="get" action="/supper-club/continue" className="flex flex-col gap-5">
            {product.optionTypes.map((type, index) => (
              <OptionPicker
                key={type.id}
                name={type.id}
                legend={t("supperClub.pickerLegend", { n: index + 1, name: type.name })}
                options={type.options.map((option) => ({
                  value: option.id,
                  label: option.name,
                  ...(option.priceCents > 0 ? { detail: t("supperClub.price", { price: formatUsdWhole(option.priceCents) }) } : {}),
                }))}
                selected={choices[type.id] ?? ""}
              />
            ))}
            <Hint>{t("supperClub.switchHelp")}</Hint>
            <p className="font-display text-section text-teal">
              {t("supperClub.accountLegend", { n: product.optionTypes.length + 1 })}
            </p>
            {member ? (
              <>
                <p>{t("supperClub.signedInAs", { email: member.email })}</p>
                <Button kind="primary" type="button">
                  {t("supperClub.continueToPayment")}
                </Button>
              </>
            ) : (
              <>
                <p>{t("supperClub.signedOutPrompt")}</p>
                <ButtonRow>
                  <Button kind="primary" type="submit" name="next" value="create-account">
                    {t("supperClub.createAccount")}
                  </Button>
                  <Button kind="secondary" type="submit" name="next" value="sign-in">
                    {t("home.signIn")}
                  </Button>
                </ButtonRow>
              </>
            )}
          </form>
        </Card>
      </section>
    </Shell>
  );
}
