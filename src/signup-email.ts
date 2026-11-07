import { legalFooter, withSignOff } from "./email-templates.js";
import { createTranslator } from "./i18n.js";
import type { Member } from "./members.js";
import { formatUsdWhole } from "./money.js";
import { formatPickupDate } from "./pickup-week.js";
import type { EmailPort, EmailReceipt } from "./ports/email.js";
import type { SignupConfirmation } from "./ports/repository.js";

/**
 * The confirmation email, in the member's language, through the email port. It builds its own text:
 * the option rows vary in number, and the done page's strings are reused so the two can't disagree.
 * `accountUrl` is the whole link, since the core can't know the app's paths; `siteUrl` is the site's
 * address, for the legal footer's links.
 */
export function deliverSignupConfirmation(
  email: EmailPort,
  member: Member,
  confirmation: SignupConfirmation,
  accountUrl: string,
  siteUrl: string,
): Promise<EmailReceipt> {
  const t = createTranslator(member.language);
  const weekly = formatUsdWhole(confirmation.weeklyCents);
  const subject = t("supperClub.done.title");
  const heading =
    member.firstName === null ? subject : t("email.signupConfirmation.heading", { firstName: member.firstName });

  const blocks = [
    heading,
    t("email.signupConfirmation.thanks"),
    [
      ...confirmation.options.map((option) => `${option.typeName}: ${option.optionName}`),
      `${t("supperClub.box.paidToday")}: ${formatUsdWhole(confirmation.firstChargeCents)}`,
      `${t("supperClub.weeklyLabel")}: ${weekly}`,
      t("supperClub.box.firstPickup", { date: formatPickupDate(confirmation.pickupDate, member.language) }),
    ].join("\n"),
    `${t("email.signupConfirmation.pickup")}\n${t("supperClub.box.pickupWhere")}`,
    `${t("email.signupConfirmation.eachWeek")}\n${[
      t("supperClub.next.menu"),
      t("supperClub.next.charge", { price: weekly }),
      t("supperClub.next.change"),
    ].join(" ")}`,
    `${t("supperClub.done.account")}: ${accountUrl}`,
    t("email.signupConfirmation.signIn"),
    t("email.signupConfirmation.questions"),
  ];
  const footer = [t("email.signupConfirmation.footerFarm"), t("email.signupConfirmation.footerReason")].join("\n");
  const text = `${withSignOff(t, blocks.join("\n\n"))}\n${footer}\n\n${legalFooter(t, siteUrl)}`;
  return email.send({ to: member.email, subject, text });
}
