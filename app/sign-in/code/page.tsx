import { Card } from "../../../components/ui/card";
import { Shell } from "../../../components/ui/shell";
import { SignInCodeStep } from "../code-step";
import { requestCode, verifyCode } from "../actions";
import { SIGN_IN_PAGES } from "../../paths";

export default async function SignInCode({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <Shell>
      <Card>{await SignInCodeStep({ pages: SIGN_IN_PAGES, verify: verifyCode, resend: requestCode, error })}</Card>
    </Shell>
  );
}
