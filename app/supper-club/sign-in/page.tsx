import { Card } from "../../../components/ui/card";
import { SignInForm } from "../../sign-in/sign-in-form";
import { requestPaneCode } from "../actions";
import { BackToChoices, JoinPage } from "../join-page";
import { PANE_CREATE_PAGES } from "../paths";
import { titled } from "../../page-title";

export const generateMetadata = titled("signIn.title");

/** Sign-in in the Supper Club page's right pane: `/sign-in` with its failures kept in the pane. */
export default async function PaneSignIn({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const { limited, error } = await searchParams;
  return await JoinPage({
    pane: "sign-in",
    children: (
      <Card width="pane">
        {await SignInForm({
          action: requestPaneCode,
          limited,
          error,
          createHref: PANE_CREATE_PAGES.start,
          back: await BackToChoices(),
        })}
      </Card>
    ),
  });
}
