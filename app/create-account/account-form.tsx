// The card body of Create Account's details step, for `/create-account` and the Supper Club's Create
// Account pane: its notices, the optional `back` line, the heading, the form and the closing line to
// sign-in. It reads the draft cookie itself. Called inline with `await`, as `JoinPage` is, because
// `findAll` does not enter a component.
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Button } from "../../components/ui/button";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { AccountFields, readDraft } from "../account-fields";
import { getLanguage, getTranslator } from "../language";
import { ACCOUNT_DRAFT_COOKIE } from "../session";
import { limitedMinutes, limitedText } from "../sign-in/shared";

export async function AccountForm({
  action,
  limited,
  error,
  signInHref,
  back,
}: {
  action: (formData: FormData) => Promise<void>;
  limited?: string;
  error?: string;
  signInHref: string;
  back?: ReactNode;
}) {
  const [t, language, cookieStore] = await Promise.all([getTranslator(), getLanguage(), cookies()]);
  const minutes = limitedMinutes(limited);
  // The form refills only after a failed request: `error` is present, whatever it names.
  const draft = error === undefined ? {} : readDraft(cookieStore.get(ACCOUNT_DRAFT_COOKIE)?.value);
  const failing = new Set(error?.split(","));
  return (
    <>
      {minutes !== null && <Notice icon="lock">{limitedText(language, minutes)}</Notice>}
      {error === "expired" && <Notice icon="clock">{t("signIn.stepExpired")}</Notice>}
      {back}
      <Heading>{t("createAccount.title")}</Heading>
      <form action={action} noValidate className="flex flex-col gap-6">
        {await AccountFields({ values: draft, failing, emailHelp: "createAccount.emailHelp" })}
        <Button kind="primary" full type="submit">
          {t("signIn.sendCode")}
        </Button>
      </form>
      <Hint rule>
        {t("createAccount.haveAccount")}{" "}
        <Button kind="quiet" href={signInHref}>
          {t("home.signIn")}
        </Button>
      </Hint>
    </>
  );
}
