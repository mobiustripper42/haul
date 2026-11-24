import { redirect } from "next/navigation";
import { resolveChoices } from "@core/choices.js";
import type { Translator } from "@core/i18n.js";
import { memberDisplayName, type Member } from "@core/members.js";
import { clevelandDate, firstPickup, pickupWeek } from "@core/pickup-week.js";
import { isSoldOut, requireSupperClub, type ProductWithOptions } from "@core/products.js";
import { isChargeOut } from "@core/signup.js";
import type { PendingSignup } from "@core/ports/repository.js";
import { Button } from "../../components/ui/button";
import { ButtonRow } from "../../components/ui/button-row";
import { Card } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { cardEntrySettings } from "../card-entry-settings";
import { getLanguage, getTranslator } from "../language";
import { MealPickers } from "../meal-pickers";
import { getFarmContactEmail, getRepository } from "../services";
import { getSignedInMember } from "../session";
import { JoinPage } from "./join-page";
import { paymentWording } from "./payment-wording";
import { PaymentSection } from "./payment-section";
import { picksOf } from "./picks";
import { PAY_ERROR_SOLD_OUT, SUPPER_CLUB_ALREADY_PATH } from "./paths";
import { SoldOutCard } from "./sold-out-card";
import { titled } from "../page-title";

const PAY_ERRORS = ["consent", "declined", "error"] as const;

export const generateMetadata = titled("supperClub.joinTitle");

/** Step 3's line: who is signed in, by name where the member has one. */
function signedInText(t: Translator, member: Member): string {
  const name = memberDisplayName(member);
  return name === null
    ? t("supperClub.signedInAs", { email: member.email })
    : t("supperClub.signedInAsNamed", { name, email: member.email });
}

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

/**
 * The first day of the pickup week a payment is for: the first week still open, or, over a charge that is out, the row's own
 * week, though its cutoff has passed, by the days it has now (a moved week is named by its moved days).
 */
async function pickupDayOf(product: ProductWithOptions, out: PendingSignup | null): Promise<string> {
  const repo = getRepository();
  if (out) {
    const changed = (await repo.listChangedWeeks(product.id, out.pickupDate)).find((week) => week.weekOf === out.pickupDate) ?? null;
    return pickupWeek(out.pickupDate, changed).firstDay;
  }
  const now = new Date();
  return firstPickup(product, now, await repo.listChangedWeeks(product.id, clevelandDate(now))).firstDay;
}

/**
 * Section 4: the words for every price the picks can come to, made here so what is shown is what is stored. Over a charge
 * that is out (`out`), the card form for that row: its picks, named in the price panel, its week, and no `payError=error`,
 * which the retry notice above it has already said.
 */
async function paymentSection({
  t,
  product,
  member,
  choices,
  query,
  out,
}: {
  t: Translator;
  product: ProductWithOptions;
  member: Member;
  choices: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  out: PendingSignup | null;
}) {
  const language = await getLanguage();
  const found = PAY_ERRORS.find((known) => known === query.payError);
  const payError = out && found === "error" ? undefined : found;
  const pickupDay = await pickupDayOf(product, out);
  return (
    <PaymentSection
      summary={out ? boxOf(product, out) : undefined}
      prices={product.optionTypes.map((type) => ({
        typeId: type.id,
        options: type.options.map((option) => ({ id: option.id, priceCents: option.priceCents })),
      }))}
      choices={choices}
      wordings={Object.fromEntries(
        pricesOf(product).map((priceCents) => [String(priceCents), paymentWording(t, { priceCents, firstPickup: pickupDay, language })]),
      )}
      payError={payError}
      text={{
        legend: t("supperClub.paymentLegend", { n: product.optionTypes.length + 2 }),
        cardLabel: t("supperClub.cardLabel"),
        cardHint: t("supperClub.cardHint"),
        testCard: t("supperClub.testCard"),
        cardFailed: t("supperClub.cardFailed"),
        cardRefused: t("supperClub.cardRefused"),
        cardLoading: t("supperClub.cardLoading"),
        todayLabel: t("supperClub.todayLabel"),
        weeklyLabel: t("supperClub.weeklyLabel"),
        consentError: t("supperClub.consentError"),
        declined: t("supperClub.payDeclined"),
        error: t("supperClub.payError"),
        capHint: t("supperClub.capHint"),
      }}
      card={cardEntrySettings(member)}
    />
  );
}

/**
 * The Supper Club: `JoinPage`'s frame (the header, the farm's copy), then a card with one picker per option
 * type of the product, so an option type added in data adds a picker. The pickers and both account buttons
 * are one GET form to `/supper-club/continue`, which keeps the choices through sign-in; signed in, the form
 * is a GET to this page, so Enter on a radio keeps the choices and never reaches sign-in, and the payment
 * section is its own POST form after it. A member who already has a subscription goes to the already page, picks
 * discarded; one whose payment got no answer sees the card form over the row's picks instead of the pickers, with the
 * retry notice, decided by their pending row and never by the URL. At the cap everyone else sees the sold-out card
 * in the Join card's place, decided by the count and never by the URL.
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
  // The charge went out and no answer came back: the member enters their card again, for the row's picks.
  const stranded = pending !== null && isChargeOut(pending) ? pending : null;

  // The cap is read from the count, never the URL. A stranded payment holds its own spot, so it is never sold out.
  if (!stranded && isSoldOut(product, await repo.countHeldSpots(product.id))) {
    return await JoinPage({
      pane: "none",
      children: <SoldOutCard t={t} notice={query.payError === PAY_ERROR_SOLD_OUT} email={getFarmContactEmail()} />,
    });
  }

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
            <p>{signedInText(t, member)}</p>
            <Notice icon="alert">{t("supperClub.retryNotice")}</Notice>
            {await paymentSection({ t, product, member, choices: (await picksOf(repo, member.id)) ?? choices, query, out: stranded })}
          </>
        ) : (
          <>
            <form method="get" action={member ? "/supper-club" : "/supper-club/continue"} className="flex flex-col gap-5">
              {MealPickers({ product, selected: choices, t })}
              <Hint>{t("supperClub.switchHelp")}</Hint>
              {accountLegend}
              {member ? (
                <p>{signedInText(t, member)}</p>
              ) : (
                <>
                  <p>{t("supperClub.signedOutPrompt")}</p>
                  <ButtonRow>
                    <Button kind="primary" type="submit" name="next" value="create-account" loadsPage>
                      {t("supperClub.createAccount")}
                    </Button>
                    <Button kind="secondary" type="submit" name="next" value="sign-in" loadsPage>
                      {t("home.signIn")}
                    </Button>
                  </ButtonRow>
                </>
              )}
            </form>
            {member && query.payError === "unknown" && <Notice icon="alert">{t("supperClub.retryNotice")}</Notice>}
            {member && (await paymentSection({ t, product, member, choices, query, out: null }))}
          </>
        )}
      </Card>
    ),
  });
}
