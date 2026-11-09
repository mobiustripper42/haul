import { LANGUAGES } from "@core/i18n.js";
import { Button, type ButtonFlush } from "../components/ui/button";
import { getLanguage, getTranslator } from "./language";
import { setLanguage } from "./language-actions";

/**
 * The language switch, one option per language, each named in itself. Called inline,
 * `{await LanguageSwitcher()}`, never as `<LanguageSwitcher />`: a test renders the page through
 * react-dom/server, which cannot render an async component written as JSX. `flush` goes to the last
 * option, for a header whose row the switch ends (issue 84).
 */
export async function LanguageSwitcher({ flush }: { flush?: Extract<ButtonFlush, string> } = {}) {
  const [t, current] = await Promise.all([getTranslator(), getLanguage()]);
  const codes = Object.keys(LANGUAGES);
  return (
    <form action={setLanguage}>
      <fieldset className="lang-switch">
        <legend className="sr-only">{t("language.label")}</legend>
        {Object.entries(LANGUAGES).map(([code, { name }]) => (
          <Button
            key={code}
            kind="quiet"
            type="submit"
            name="language"
            value={code}
            lang={code}
            aria-current={code === current ? "true" : undefined}
            {...(flush && code === codes.at(-1) ? { flush } : {})}
          >
            {name}
          </Button>
        ))}
      </fieldset>
    </form>
  );
}
