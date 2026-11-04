import { Button } from "../components/ui/button";
import { getTranslator } from "./language";
import { LanguageSwitcher } from "./language-switcher";

/**
 * The header every public page opens with: the farm's name, then the language switch. `account` adds
 * a link after the switch: "sign-in" a secondary Sign in, "your-account" a link to the home page
 * (there is no account page until 2.4). Called inline, `{await SiteHeader({ account })}`, as
 * `LanguageSwitcher` is.
 */
export async function SiteHeader({ account }: { account: "none" | "sign-in" | "your-account" }) {
  const t = await getTranslator();
  const switcher = await LanguageSwitcher();
  return (
    <header className="border-b border-divider bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3">
        <a href="/" className="flex flex-col">
          <span className="font-display text-wordmark text-teal uppercase">{t("brand.name")}</span>
          <span className="text-byline text-ink-muted">{t("brand.byline")}</span>
        </a>
        {account === "none" ? (
          switcher
        ) : (
          <div className="flex items-center gap-4">
            {switcher}
            {account === "sign-in" ? (
              <Button kind="secondary" href="/sign-in">
                {t("home.signIn")}
              </Button>
            ) : (
              <Button kind="quiet" href="/">
                {t("home.yourAccount")}
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
