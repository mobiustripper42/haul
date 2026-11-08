// The code step of both flows, and of both flows in the Supper Club's panes: one component, so the code
// field, its notice and the resend line are written once. `SignInCodeStep` and `AccountCodeStep` hold
// what each flow brings: the email-cookie guard, the `invalid` check and the words. Called inline with
// `await`, as `JoinPage` is, because `findAll` does not enter a component (app/screen-test-helpers.ts).
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CODE_TTL_MS } from "@core/sign-in/code.js";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Input } from "../../components/ui/input";
import { Notice } from "../../components/ui/notice";
import { getTranslator } from "../language";
import { SIGN_IN_EMAIL_COOKIE } from "../session";
import type { FlowPages } from "./shared";

type FormAction = (formData: FormData) => Promise<void>;
type FlowStep = (props: { pages: FlowPages; verify: FormAction; resend: FormAction; error?: string; sent?: string }) => Promise<ReactNode>;

/**
 * A code step's card body: the back link, the heading, the sentence, the notice for a new code, the notice for a wrong code, the
 * code form, an optional `hint` line, and the resend form. `resendEmail`, when given, rides in the resend
 * form as a hidden `email`, for a resend action that reads it from the form.
 */
export async function CodeStep({
  heading,
  sentence,
  buttonLabel,
  verify,
  resend,
  backHref,
  invalid,
  sent,
  hint,
  resendEmail,
}: {
  heading: string;
  sentence: string;
  buttonLabel: string;
  verify: FormAction;
  resend: FormAction;
  backHref: string;
  invalid: boolean;
  sent: boolean;
  hint?: string;
  resendEmail?: string;
}) {
  const t = await getTranslator();
  return (
    <>
      <p>
        <Button kind="quiet" href={backHref} back flush>
          {t("signIn.differentEmail")}
        </Button>
      </p>
      <Heading>{heading}</Heading>
      <p className="text-ink-muted">{sentence}</p>
      {sent && !invalid && <Notice icon="check">{t("signIn.resent")}</Notice>}
      {invalid && <Notice icon="alert">{t("signIn.invalidCode")}</Notice>}
      <form action={verify} className="flex flex-col gap-6">
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
          {buttonLabel}
        </Button>
      </form>
      {hint !== undefined && <Hint>{hint}</Hint>}
      <form action={resend}>
        {resendEmail !== undefined && <input type="hidden" name="email" value={resendEmail} />}
        <input type="hidden" name="resend" value="1" />
        <Button kind="quiet" flush type="submit">
          {t("signIn.resend")}
        </Button>
      </form>
    </>
  );
}

/** Sign-in's code step. With no email cookie the flow's start, expired. The resend form carries the cookie's email. */
export const SignInCodeStep: FlowStep = async ({ pages, verify, resend, error, sent }) => {
  const email = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${pages.start}?error=expired`);
  const t = await getTranslator();
  return await CodeStep({
    heading: t("signIn.codeTitle"),
    sentence: t("signIn.codeSent", { email, minutes: CODE_TTL_MS / 60_000 }),
    buttonLabel: t("signIn.submitCode"),
    verify,
    resend,
    backHref: pages.start,
    invalid: error === "invalid",
    sent: sent === "1",
    resendEmail: email,
  });
};

/** Create Account's code step, redeemed by sign-in's own flow. Its resend action reads the cookie, so the form carries no email. */
export const AccountCodeStep: FlowStep = async ({ pages, verify, resend, error, sent }) => {
  const email = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${pages.start}?error=expired`);
  const t = await getTranslator();
  return await CodeStep({
    heading: t("createAccount.codeTitle"),
    sentence: t("createAccount.codeSent", { email, minutes: CODE_TTL_MS / 60_000 }),
    buttonLabel: t("createAccount.confirm"),
    verify,
    resend,
    backHref: pages.start,
    invalid: error === "invalid",
    sent: sent === "1",
    hint: t("createAccount.spam"),
  });
};
