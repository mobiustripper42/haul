// The card body of sign-in's email step, for `/sign-in` and the Supper Club's sign-in pane: its notices,
// the optional `back` line, the heading, the form and the closing line to Create Account. Called inline
// with `await`, as `JoinPage` is, because `findAll` does not enter a component.
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Input } from "../../components/ui/input";
import { Notice } from "../../components/ui/notice";
import { getLanguage, getTranslator } from "../language";
import { limitedMinutes, limitedText } from "./shared";

export async function SignInForm({
  action,
  limited,
  error,
  createHref,
  back,
}: {
  action: (formData: FormData) => Promise<void>;
  limited?: string;
  error?: string;
  createHref: string;
  back?: ReactNode;
}) {
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const minutes = limitedMinutes(limited);
  const noticeKey = error === "expired" ? "signIn.stepExpired" : error === "link" ? "signIn.linkFailed" : null;
  return (
    <>
      {back}
      <Heading>{t("signIn.title")}</Heading>
      {minutes !== null && <Notice icon="lock">{limitedText(language, minutes)}</Notice>}
      {noticeKey && <Notice icon="clock">{t(noticeKey)}</Notice>}
      <form action={action} className="flex flex-col gap-6">
        <Field label={t("signIn.emailLabel")} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Button kind="primary" full type="submit">
          {t("signIn.sendCode")}
        </Button>
      </form>
      <Hint rule>
        {t("signIn.noAccount")}{" "}
        <Button kind="quiet" href={createHref}>
          {t("supperClub.createAccount")}
        </Button>
      </Hint>
    </>
  );
}
