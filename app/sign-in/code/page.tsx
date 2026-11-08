import { Card } from "../../../components/ui/card";
import { Shell } from "../../../components/ui/shell";
import { SignInCodeStep } from "../code-step";
import { requestCode, verifyCode } from "../actions";
import { SIGN_IN_PAGES } from "../../paths";
import { titled } from "../../page-title";

export const generateMetadata = titled("signIn.codeTitle");

export default async function SignInCode({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return (
    <Shell>
      <Card>{await SignInCodeStep({ pages: SIGN_IN_PAGES, verify: verifyCode, resend: requestCode, error, sent })}</Card>
    </Shell>
  );
}
