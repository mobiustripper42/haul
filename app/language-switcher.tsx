import { LANGUAGES } from "@core/i18n.js";
import { getLanguage, getTranslator } from "./language";
import { setLanguage } from "./language-actions";

/**
 * The language switch, one option per language, each named in itself. Called inline,
 * `{await LanguageSwitcher()}`, never as `<LanguageSwitcher />`: a test renders the page through
 * react-dom/server, which cannot render an async component written as JSX.
 */
export async function LanguageSwitcher() {
  const [t, current] = await Promise.all([getTranslator(), getLanguage()]);
  return (
    <form action={setLanguage}>
      <fieldset className="lang-switch">
        <legend className="sr-only">{t("language.label")}</legend>
        {Object.entries(LANGUAGES).map(([code, { name }]) => (
          <button
            key={code}
            type="submit"
            name="language"
            value={code}
            lang={code}
            aria-current={code === current ? "true" : undefined}
            className={`btn-quiet ${code === current ? "font-semibold" : "text-teal-muted"}`}
          >
            {name}
          </button>
        ))}
      </fieldset>
    </form>
  );
}
