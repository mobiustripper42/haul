import { formatUsd } from "@core/money.js";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Heading } from "../components/ui/heading";
import { Shell } from "../components/ui/shell";
import { getTranslator } from "./language";
import { LanguageSwitcher } from "./language-switcher";
import { getSignedInMember } from "./session";
import { signOut } from "./sign-in/actions";

// Developer placeholder, replaced when task 1.3 lands. It exists so `next build` resolves the
// core's `.js` specifiers through the @core/* alias, and to prove the page renders in Spanish.
export default async function Home() {
  const [t, member] = await Promise.all([getTranslator(), getSignedInMember()]);
  return (
    <Shell>
      <Card>
        <Heading>{t("home.title")}</Heading>
        <p>{t("home.coreCheck", { amount: formatUsd(1234) })}</p>
        {member ? (
          <>
            <p>{t("home.signedInAs", { email: member.email })}</p>
            {member.role === "admin" && (
              <p>
                <a href="/admin">{t("home.adminPage")}</a>
              </p>
            )}
            <form action={signOut}>
              <Button kind="secondary" type="submit">
                {t("home.signOut")}
              </Button>
            </form>
          </>
        ) : (
          <p>
            <a href="/sign-in">{t("home.signIn")}</a>
          </p>
        )}
        {await LanguageSwitcher()}
      </Card>
    </Shell>
  );
}
