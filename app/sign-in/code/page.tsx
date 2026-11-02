import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CODE_TTL_MS } from "@core/sign-in/code.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Field } from "../../../components/ui/field";
import { Heading } from "../../../components/ui/heading";
import { Input } from "../../../components/ui/input";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { getTranslator } from "../../language";
import { SIGN_IN_EMAIL_COOKIE } from "../../session";
import { requestCode, verifyCode } from "../actions";

export default async function SignInCode({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const email = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/sign-in?error=expired");

  const [t, { error }] = await Promise.all([getTranslator(), searchParams]);
  const invalid = error === "invalid";
  return (
    <Shell>
      <Card>
        <p>
          <Button kind="quiet" href="/sign-in" back flush>
            {t("signIn.differentEmail")}
          </Button>
        </p>
        <Heading>{t("signIn.codeTitle")}</Heading>
        <p className="text-ink-muted">{t("signIn.codeSent", { email, minutes: CODE_TTL_MS / 60_000 })}</p>
        {invalid && <Notice icon="alert">{t("signIn.invalidCode")}</Notice>}
        <form action={verifyCode} className="flex flex-col gap-6">
          <Field label={t("signIn.codeLabel")} htmlFor="code">
            <Input
              code
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              aria-invalid={invalid ? true : undefined}
            />
          </Field>
          <Button kind="primary" full type="submit">
            {t("signIn.submitCode")}
          </Button>
        </form>
        <form action={requestCode}>
          <input type="hidden" name="email" value={email} />
          <Button kind="quiet" flush type="submit">
            {t("signIn.resend")}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
