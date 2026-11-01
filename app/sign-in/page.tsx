import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Heading } from "../../components/ui/heading";
import { Input } from "../../components/ui/input";
import { Notice } from "../../components/ui/notice";
import { Shell } from "../../components/ui/shell";
import { getTranslator } from "../language";
import { requestCode } from "./actions";

/** The `limited` notice's minutes: an integer from 1 to 60, anything else shows no notice. */
const limitedMinutes = (value: string | undefined): number | null => {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const minutes = Number(value);
  return minutes <= 60 ? minutes : null;
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const [t, { limited, error }] = await Promise.all([getTranslator(), searchParams]);
  const minutes = limitedMinutes(limited);
  const noticeKey = error === "expired" ? "signIn.stepExpired" : error === "link" ? "signIn.linkFailed" : null;
  return (
    <Shell>
      <Card>
        <Heading>{t("signIn.title")}</Heading>
        {minutes !== null && <Notice icon="lock">{t("signIn.limited", { minutes })}</Notice>}
        {noticeKey && <Notice icon="clock">{t(noticeKey)}</Notice>}
        <form action={requestCode} className="flex flex-col gap-6">
          <Field label={t("signIn.emailLabel")} htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button kind="primary" full type="submit">
            {t("signIn.sendCode")}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
