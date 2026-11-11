import { Button } from "../components/ui/button";
import { SiteBar } from "../components/ui/site-bar";
import { getTranslator } from "./language";
import { LanguageSwitcher } from "./language-switcher";
import { ACCOUNT_PATH, ADMIN_PATH } from "./paths";
import { getSignedInMember } from "./session";
import { signOut } from "./sign-in/actions";
import { PANE_SIGN_IN_PAGES } from "./supper-club/paths";

/**
 * The header every public page opens with: the farm's name, then the language switch. Signed in, the
 * header reads the session itself: a Your account button (`current: "account"` marks it as the page
 * showing), an Admin button (admins only; `current: "admin"` likewise), then Sign out. Signed out,
 * `account` adds a link after the switch: "sign-in" a secondary Sign in to the Supper Club's sign-in
 * pane, "sign-in-current" the same link marked as the page showing, "none" nothing. `wideOnly` hides a Sign in at widths below `lg`, for a pane page whose card already is
 * the sign-in. Called inline, `{await SiteHeader({ account })}`, as `LanguageSwitcher` is.
 */
export async function SiteHeader({
  account,
  wideOnly,
  current,
}: {
  account: "none" | "sign-in" | "sign-in-current";
  wideOnly?: boolean;
  current?: "admin" | "account";
}) {
  const [t, member] = await Promise.all([getTranslator(), getSignedInMember()]);
  // The quiet button that ends the row is pulled flush with the gutter (issue 84): the switch when nothing
  // follows it, or when Sign in is hidden below `lg`; signed in, Sign out.
  const switchFlush = member ? undefined : account === "none" ? "end" : wideOnly ? "end-narrow" : undefined;
  const switcher = await LanguageSwitcher(switchFlush ? { flush: switchFlush } : {});
  const signIn = (
    <Button kind="secondary" href={PANE_SIGN_IN_PAGES.start} current={account === "sign-in-current"}>
      {t("home.signIn")}
    </Button>
  );
  return (
    <SiteBar as="header">
      <a href="/" className="flex flex-col">
        <span className="font-display text-wordmark text-teal uppercase">{t("brand.name")}</span>
        <span className="text-byline text-ink-muted">{t("brand.byline")}</span>
      </a>
      {member ? (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 lg:flex-nowrap">
          {switcher}
          <Button kind="secondary" nowrap href={ACCOUNT_PATH} current={current === "account"}>
            {t("header.account")}
          </Button>
          {member.role === "admin" && (
            <Button kind="secondary" nowrap href={ADMIN_PATH} current={current === "admin"}>
              {t("header.admin")}
            </Button>
          )}
          <form action={signOut}>
            <Button kind="quiet" nowrap type="submit" flush="end">
              {t("home.signOut")}
            </Button>
          </form>
        </div>
      ) : account === "none" ? (
        switcher
      ) : (
        <div className="flex items-center gap-4">
          {switcher}
          {wideOnly ? <div className="wide-only">{signIn}</div> : signIn}
        </div>
      )}
    </SiteBar>
  );
}
