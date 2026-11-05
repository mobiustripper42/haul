import { resolveChoices } from "@core/choices.js";
import { formatUsdWhole } from "@core/money.js";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../../components/ui/button";
import { ButtonRow } from "../../components/ui/button-row";
import { Card } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { OptionPicker } from "../../components/ui/option-picker";
import { getTranslator } from "../language";
import { getRepository } from "../services";
import { getSignedInMember } from "../session";
import { JoinPage } from "./join-page";

/**
 * The Supper Club: `JoinPage`'s frame (the header, the farm's copy), then a card with one picker per option
 * type of the product, so an option type added in data adds a picker. The pickers and both account buttons
 * are one GET form to `/supper-club/continue`, which keeps the choices through sign-in; signed in, the form
 * is a GET to this page, so Enter on a radio keeps the choices and never reaches sign-in. There is no
 * client script.
 */
export default async function SupperClub({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, query, member] = await Promise.all([getTranslator(), searchParams, getSignedInMember()]);
  const product = await requireSupperClub(getRepository());
  const choices = resolveChoices(product, query);

  return await JoinPage({
    pane: "none",
    children: (
      <Card width="fill">
        <p className="font-display text-heading text-teal">{t("supperClub.joinTitle")}</p>
        <form method="get" action={member ? "/supper-club" : "/supper-club/continue"} className="flex flex-col gap-5">
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
    ),
  });
}
