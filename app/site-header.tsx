import { Button } from "../components/ui/button";
import { getTranslator } from "./language";
import { LanguageSwitcher } from "./language-switcher";
import { PANE_SIGN_IN_PAGES } from "./supper-club/paths";

/**
 * The header every public page opens with: the farm's name, then the language switch. `account` adds
 * a link after the switch: "sign-in" a secondary Sign in to the Supper Club's sign-in pane,
 * "sign-in-current" the same link marked as the page showing, "your-account" a link to the home page
 * (there is no account page until 2.4). `wideOnly` hides a Sign in at widths below `lg`, for a pane page
 * whose card already is the sign-in. Called inline, `{await SiteHeader({ account })}`, as
 * `LanguageSwitcher` is.
 */
export async function SiteHeader({
  account,
  wideOnly,
}: {
  account: "none" | "sign-in" | "sign-in-current" | "your-account";
  wideOnly?: boolean;
}) {
  const t = await getTranslator();
  const switcher = await LanguageSwitcher();
  const signIn = (
    <Button kind="secondary" href={PANE_SIGN_IN_PAGES.start} current={account === "sign-in-current"}>
      {t("home.signIn")}
    </Button>
  );
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
            {account === "your-account" ? (
              <Button kind="quiet" href="/">
                {t("home.yourAccount")}
              </Button>
            ) : wideOnly ? (
              <div className="wide-only">{signIn}</div>
            ) : (
              signIn
            )}
          </div>
        )}
      </div>
    </header>
  );
}
