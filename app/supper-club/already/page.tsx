import { redirect } from "next/navigation";
import { requireSupperClub } from "@core/products.js";
import { Card } from "../../../components/ui/card";
import { Hint } from "../../../components/ui/hint";
import { getTranslator } from "../../language";
import { getRepository } from "../../services";
import { getSignedInMember } from "../../session";
import { JoinPage } from "../join-page";
import { SUPPER_CLUB_PATH } from "../paths";
import { titled } from "../../page-title";

export const generateMetadata = titled("supperClub.already.title");

/**
 * What a member who already has a box is told, in the Supper Club page's right pane (no mockup: it is the
 * pane's card alone). A member with no active subscription, or a visitor, is sent to the Supper Club page.
 * Viewing it records nothing: the event is `signUp`'s, when a pay is submitted anyway.
 */
export default async function SupperClubAlready() {
  const [t, member] = await Promise.all([getTranslator(), getSignedInMember()]);
  if (!member) redirect(SUPPER_CLUB_PATH);
  const repo = getRepository();
  if (!(await repo.findSignupConfirmation(member.id, (await requireSupperClub(repo)).id))) redirect(SUPPER_CLUB_PATH);

  return await JoinPage({
    pane: "already",
    children: (
      <Card width="pane">
        <p className="font-display text-heading text-teal">{t("supperClub.already.title")}</p>
        <Hint>{t("supperClub.already.nothing")}</Hint>
      </Card>
    ),
  });
}
