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
  const invalid = error === "invalid";
  return (
    <main className="page-narrow">
      <section className="card">
        <p>
          <a href="/sign-in" className="btn-quiet back-link">
            {t("signIn.differentEmail")}
          </a>
        </p>
        <h1 className="font-display text-heading text-teal">{t("signIn.codeTitle")}</h1>
        <p className="text-ink-muted">{t("signIn.codeSent", { email, minutes: CODE_TTL_MS / 60_000 })}</p>
        {invalid && (
          <p role="alert" className="notice notice-alert">
            {t("signIn.invalidCode")}
          </p>
        )}
        <form action={verifyCode} className="flex flex-col gap-6">
          <p>
            <label htmlFor="code" className="mb-2 block text-field-label">
              {t("signIn.codeLabel")}
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              aria-invalid={invalid ? true : undefined}
              className="field field-code"
            />
          </p>
          <button type="submit" className="btn-primary w-full">
            {t("signIn.submitCode")}
          </button>
        </form>
        <form action={requestCode}>
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="btn-quiet w-full">
            {t("signIn.resend")}
          </button>
        </form>
      </section>
    </main>
  );
}
