import { Card } from "../../../components/ui/card";
import { AccountForm } from "../../create-account/account-form";
import { BackToChoices, JoinPage } from "../join-page";
import { requestPaneAccountCode } from "../actions";
import { PANE_SIGN_IN_PAGES } from "../paths";

/** Create Account in the Supper Club page's right pane: `/create-account` with its failures kept in the pane. */
export default async function PaneCreateAccount({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const { limited, error } = await searchParams;
  return await JoinPage({
    pane: "create-account",
    children: (
      <Card width="pane">
        {await AccountForm({
          action: requestPaneAccountCode,
          limited,
          error,
          signInHref: PANE_SIGN_IN_PAGES.start,
          back: await BackToChoices(),
        })}
      </Card>
    ),
  });
}
