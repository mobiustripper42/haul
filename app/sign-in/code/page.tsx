import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CODE_TTL_MS } from "@core/sign-in/code.js";
import { getTranslator } from "../../language";
import { SIGN_IN_EMAIL_COOKIE } from "../../session";
import { requestCode, verifyCode } from "../actions";

export default async function SignInCode({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const email = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/sign-in?error=expired");

  const [t, { error }] = await Promise.all([getTranslator(), searchParams]);
  return (
    <main>
      <h1>{t("signIn.codeTitle")}</h1>
      <p>{t("signIn.codeSent", { email, minutes: CODE_TTL_MS / 60_000 })}</p>
      {error === "invalid" && <p role="alert">{t("signIn.invalidCode")}</p>}
      <form action={verifyCode}>
        <p>
          <label htmlFor="code">{t("signIn.codeLabel")}</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
          />
        </p>
        <button type="submit">{t("signIn.submitCode")}</button>
      </form>
      <form action={requestCode}>
        <input type="hidden" name="email" value={email} />
        <button type="submit">{t("signIn.resend")}</button>
      </form>
      <p>
        <a href="/sign-in">{t("signIn.differentEmail")}</a>
      </p>
    </main>
  );
}
