import { Card } from "../../../../components/ui/card";
import { AccountCodeStep } from "../../../sign-in/code-step";
import { resendPaneAccountCode, verifyPaneAccountCode } from "../../actions";
import { JoinPage } from "../../join-page";
import { PANE_CREATE_PAGES } from "../../paths";
import { titled } from "../../../page-title";

export const generateMetadata = titled("createAccount.codeTitle");

/** Create Account's code step in the Supper Club page's right pane. */
export default async function PaneCreateAccountCode({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return await JoinPage({
    pane: "create-account",
    children: (
      <Card width="pane">
        {await AccountCodeStep({ pages: PANE_CREATE_PAGES, verify: verifyPaneAccountCode, resend: resendPaneAccountCode, error, sent })}
      </Card>
    ),
  });
}
