import { LANGUAGES } from "@core/i18n.js";
import { formatUsd } from "@core/money.js";
import { getTranslator } from "./language";
import { setLanguage } from "./language-actions";

// Developer placeholder, replaced when task 1.3 lands. It exists so `next build` resolves the
// core's `.js` specifiers through the @core/* alias, and to prove the page renders in Spanish.
export default async function Home() {
  const t = await getTranslator();
  return (
    <main>
      <h1>{t("home.title")}</h1>
      <p>{t("home.coreCheck", { amount: formatUsd(1234) })}</p>
      <form action={setLanguage}>
        <fieldset>
          <legend>{t("language.label")}</legend>
          {Object.entries(LANGUAGES).map(([code, { name }]) => (
            <button key={code} type="submit" name="language" value={code}>
              {name}
            </button>
          ))}
        </fieldset>
      </form>
    </main>
  );
}
