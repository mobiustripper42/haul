import { redirect } from "next/navigation";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Hint } from "../../../components/ui/hint";
import { getTranslator } from "../../language";
import { ACCOUNT_WEEKS_PATH } from "../../paths";
import { getRepository } from "../../services";
import { getSignedInMember } from "../../session";
import { JoinPage } from "../join-page";
import { SUPPER_CLUB_FROM_PAY, SUPPER_CLUB_PATH } from "../paths";
import { titled } from "../../page-title";

export const generateMetadata = titled("supperClub.already.title");

/**
 * What a member who already has a box is told, in the Supper Club page's right pane (no mockup: it is the
 * pane's card alone). A member with no active subscription, or a visitor, is sent to the Supper Club page.
 * "Nothing was charged." shows only with the Pay mark (`?from=pay`), which a refused Pay or Try again carries.
 * Viewing it records nothing: the event is `signUp`'s, when a pay is submitted anyway.
 */
export default async function SupperClubAlready({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const [t, member, { from }] = await Promise.all([getTranslator(), getSignedInMember(), searchParams]);
  if (!member) redirect(SUPPER_CLUB_PATH);
  const repo = getRepository();
  if (!(await repo.findSignupConfirmation(member.id, (await requireSupperClub(repo)).id))) redirect(SUPPER_CLUB_PATH);

  return await JoinPage({
    pane: "already",
    children: (
      <Card width="pane">
        <p className="font-display text-heading text-teal">{t("supperClub.already.title")}</p>
        {from === SUPPER_CLUB_FROM_PAY && <Hint>{t("supperClub.already.nothing")}</Hint>}
        <div className="flex">
          <Button kind="primary" href={ACCOUNT_WEEKS_PATH}>
            {t("account.weeks.title")}
          </Button>
        </div>
      </Card>
    ),
  });
}
