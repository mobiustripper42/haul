import { redirect } from "next/navigation";
import { resolveChoices } from "@core/choices.js";
import type { Translator } from "@core/i18n.js";
import type { Member } from "@core/members.js";
import { formatUsdWhole } from "@core/money.js";
import { firstPickup } from "@core/pickup-week.js";
import { requireSupperClub, type ProductWithOptions } from "@core/products.js";
import type { PendingSignup } from "@core/ports/repository.js";
import { Button } from "../../components/ui/button";
import { ButtonRow } from "../../components/ui/button-row";
import { Card } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { OptionPicker } from "../../components/ui/option-picker";
import { PricePanel } from "../../components/ui/price-panel";
import { getLanguage, getTranslator } from "../language";
import { getRepository, isProduction } from "../services";
import { getSignedInMember } from "../session";
import { retrySupperClubPayment } from "./actions";
import { JoinPage } from "./join-page";
import { paymentWording } from "./payment-wording";
import { PaymentSection } from "./payment-section";
import { SUPPER_CLUB_ALREADY_PATH } from "./paths";

const PAY_ERRORS = ["consent", "declined", "error"] as const;

/** Every price the picks can come to: the sum of one option from each type. */
function pricesOf(product: ProductWithOptions): number[] {
  let sums = new Set([0]);
  for (const type of product.optionTypes) {
    sums = new Set([...sums].flatMap((sum) => type.options.map((option) => sum + option.priceCents)));
  }
  return [...sums];
}

/** The names of the options a pending row holds, in the product's order. */
function boxOf(product: ProductWithOptions, row: PendingSignup): string {
  return product.optionTypes
    .flatMap((type) => type.options.filter((option) => row.optionIds.includes(option.id)).map((option) => option.name))
    .join(" · ");
}

/** Section 4: the words for every price the picks can come to, made here so what is shown is what is stored. */
async function paymentSection({
  t,
  product,
  member,
  choices,
  query,
}: {
  t: Translator;
  product: ProductWithOptions;
  member: Member;
  choices: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
}) {
  const language = await getLanguage();
  const payError = PAY_ERRORS.find((known) => known === query.payError);
  const pickup = firstPickup(product, new Date());
  return (
    <PaymentSection
      prices={product.optionTypes.map((type) => ({
        typeId: type.id,
        options: type.options.map((option) => ({ id: option.id, priceCents: option.priceCents })),
      }))}
      choices={choices}
      wordings={Object.fromEntries(
        pricesOf(product).map((priceCents) => [String(priceCents), paymentWording(t, { priceCents, firstPickup: pickup, language })]),
      )}
      payError={payError}
      text={{
        legend: t("supperClub.paymentLegend", { n: product.optionTypes.length + 2 }),
        cardLabel: t("supperClub.cardLabel"),
        cardHint: t("supperClub.cardHint"),
        testCard: t("supperClub.testCard"),
        cardFailed: t("supperClub.cardFailed"),
        cardRefused: t("supperClub.cardRefused"),
        todayLabel: t("supperClub.todayLabel"),
        weeklyLabel: t("supperClub.weeklyLabel"),
        consentError: t("supperClub.consentError"),
        declined: t("supperClub.payDeclined"),
        error: t("supperClub.payError"),
        capHint: t("supperClub.capHint", { cap: product.cap }),
      }}
      card={{
        // CardEntry's test field stands in for Square's script on the e2e server alone, as the dev outbox does.
        testMode: !isProduction() && process.env.E2E === "1",
        applicationId: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
        locationId: process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
        billing: {
          email: member.email,
          ...(member.firstName !== null && { givenName: member.firstName }),
          ...(member.lastName !== null && { familyName: member.lastName }),
        },
      }}
    />
  );
}

/**
 * The Supper Club: `JoinPage`'s frame (the header, the farm's copy), then a card with one picker per option
 * type of the product, so an option type added in data adds a picker. The pickers and both account buttons
 * are one GET form to `/supper-club/continue`, which keeps the choices through sign-in; signed in, the form
 * is a GET to this page, so Enter on a radio keeps the choices and never reaches sign-in, and the payment
 * section is its own POST form after it. A member who already has a box goes to the already page, picks
 * discarded; one whose payment got no answer sees the retry state instead of the pickers and the payment
 * section, decided by their pending row and never by the URL.
 */
export default async function SupperClub({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, query, member] = await Promise.all([getTranslator(), searchParams, getSignedInMember()]);
  const repo = getRepository();
  const product = await requireSupperClub(repo);

  if (member && (await repo.findActiveSubscription(member.id, product.id))) redirect(SUPPER_CLUB_ALREADY_PATH);
  const pending = member ? await repo.findPendingSignup(member.id, product.id) : null;
  // The charge went out on a saved card and no answer came back: only "Try again" is left to press.
  const stranded = pending !== null && pending.ledgerStatus === "pending" && pending.squareCardId !== null ? pending : null;

  const choices = resolveChoices(product, query);
  const accountLegend = (
    <p className="font-display text-section text-teal">{t("supperClub.accountLegend", { n: product.optionTypes.length + 1 })}</p>
  );

  return await JoinPage({
    pane: "none",
    children: (
      <Card width="fill">
        <p className="font-display text-heading text-teal">{t("supperClub.joinTitle")}</p>
        {member && stranded ? (
          <>
            {accountLegend}
            <p>{t("supperClub.signedInAs", { email: member.email })}</p>
            <Notice icon="alert">{t("supperClub.retryNotice")}</Notice>
            {query.payError === "error" && <Notice icon="alert">{t("supperClub.payError")}</Notice>}
            <PricePanel
              summary={boxOf(product, stranded)}
              rows={[{ label: t("supperClub.todayLabel"), value: formatUsdWhole(stranded.amountCents) }]}
            />
            <form action={retrySupperClubPayment}>
              <Button kind="primary" type="submit" full>
                {t("supperClub.tryAgain")}
              </Button>
            </form>
          </>
        ) : (
          <>
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
              {accountLegend}
              {member ? (
                <p>{t("supperClub.signedInAs", { email: member.email })}</p>
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
            {member && (await paymentSection({ t, product, member, choices, query }))}
          </>
        )}
      </Card>
    ),
  });
}
