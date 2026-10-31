import { formatUsd } from "@core/money.js";
import { getTranslator } from "./language";
import { LanguageSwitcher } from "./language-switcher";
import { getSignedInMember } from "./session";
import { signOut } from "./sign-in/actions";

// Developer placeholder, replaced when task 1.3 lands. It exists so `next build` resolves the
// core's `.js` specifiers through the @core/* alias, and to prove the page renders in Spanish.
export default async function Home() {
  const [t, member] = await Promise.all([getTranslator(), getSignedInMember()]);
  return (
    <main>
      <h1>{t("home.title")}</h1>
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
            <button type="submit" className="btn-secondary">
              {t("home.signOut")}
            </button>
          </form>
        </>
      ) : (
        <p>
          <a href="/sign-in">{t("home.signIn")}</a>
        </p>
      )}
      {await LanguageSwitcher()}
    </main>
  );
}
