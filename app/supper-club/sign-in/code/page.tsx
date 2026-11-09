import { Card } from "../../../../components/ui/card";
import { SignInCodeStep } from "../../../sign-in/code-step";
import { requestPaneCode, verifyPaneCode } from "../../actions";
import { JoinPage } from "../../join-page";
import { PANE_SIGN_IN_PAGES } from "../../paths";
import { titled } from "../../../page-title";

export const generateMetadata = titled("signIn.codeTitle");

/** Sign-in's code step in the Supper Club page's right pane. */
export default async function PaneSignInCode({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return await JoinPage({
    pane: "sign-in",
    children: (
      <Card width="pane">
        {await SignInCodeStep({ pages: PANE_SIGN_IN_PAGES, verify: verifyPaneCode, resend: requestPaneCode, error, sent })}
      </Card>
    ),
  });
}
