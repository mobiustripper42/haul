import { redirect } from "next/navigation";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../../../components/ui/button";
import { Heading } from "../../../components/ui/heading";
import { getLanguage, getTranslator } from "../../language";
import { ACCOUNT_PATH } from "../../paths";
import { getRepository } from "../../services";
import { getSignedInMember } from "../../session";
import { JoinPage } from "../join-page";
import { FARM_SITE_URL, SUPPER_CLUB_PATH } from "../paths";
import { SignupBox } from "../signup-box";

/**
 * The signup confirmation, in the Supper Club page's right pane at `lg` and wider and alone below it.
 * It is for a member with an active subscription: anyone else is sent to the Supper Club page.
 */
export default async function SupperClubDone() {
  const [t, language, member] = await Promise.all([getTranslator(), getLanguage(), getSignedInMember()]);
  if (!member) redirect(SUPPER_CLUB_PATH);
  const repo = getRepository();
  const confirmation = await repo.findSignupConfirmation(member.id, (await requireSupperClub(repo)).id);
  if (!confirmation) redirect(SUPPER_CLUB_PATH);

  return await JoinPage({
    pane: "done",
    children: (
      <div className="pane-done">
        <div className="flex flex-col items-start gap-3">
          <svg role="img" aria-label={t("supperClub.done.mark")} width="44" height="44" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" className="fill-sage-soft" />
            <path d="M15 24.5l6 6 12-13" className="stroke-success" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Heading>{t("supperClub.done.title")}</Heading>
          <p className="text-ink-muted">
            {member.firstName === null
              ? t("supperClub.done.thanksNoName", { email: member.email })
              : t("supperClub.done.thanks", { firstName: member.firstName, email: member.email })}
          </p>
        </div>
        <SignupBox t={t} language={language} confirmation={confirmation} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button kind="primary" href={ACCOUNT_PATH}>
            {t("supperClub.done.account")}
          </Button>
          <Button kind="quiet" href={FARM_SITE_URL} flush>
            {t("supperClub.done.back")}
          </Button>
        </div>
      </div>
    ),
  });
}
