import { Card } from "../../../components/ui/card";
import { Shell } from "../../../components/ui/shell";
import { AccountCodeStep } from "../../sign-in/code-step";
import { resendAccountCode, verifyAccountCode } from "../actions";
import { CREATE_ACCOUNT_PAGES } from "../../paths";
import { titled } from "../../page-title";

export const generateMetadata = titled("createAccount.codeTitle");

/** Create Account's code step: sign-in's code step with its own words. The code is redeemed by sign-in's own flow. */
export default async function CreateAccountCode({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return (
    <Shell>
      <Card>
        {await AccountCodeStep({ pages: CREATE_ACCOUNT_PAGES, verify: verifyAccountCode, resend: resendAccountCode, error, sent })}
      </Card>
    </Shell>
  );
}
