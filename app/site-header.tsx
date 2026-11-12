import type { MessageKey } from "@core/i18n.js";
import { Button } from "../components/ui/button";
import { MenuButton } from "../components/ui/menu-button";
import { SiteBar } from "../components/ui/site-bar";
import { getTranslator } from "./language";
import { LanguageSwitcher } from "./language-switcher";
import { ACCOUNT_DETAILS_PATH, ACCOUNT_HISTORY_PATH, ACCOUNT_PATH, ACCOUNT_WEEKS_PATH, ADMIN_PATH } from "./paths";
import { getSignedInMember } from "./session";
import { signOut } from "./sign-in/actions";
import { PANE_SIGN_IN_PAGES } from "./supper-club/paths";

type Current = "admin" | "account" | "weeks" | "history" | "details";

/** The signed-in header's links in order, drawn twice from here: in the row, and in the Menu's panel. Admin is for admins only. */
const ACCOUNT_LINKS: readonly { current: Current; href: string; label: MessageKey; adminOnly?: true }[] = [
  { current: "account", href: ACCOUNT_PATH, label: "header.yourMeal" },
  { current: "weeks", href: ACCOUNT_WEEKS_PATH, label: "header.weeks" },
  { current: "history", href: ACCOUNT_HISTORY_PATH, label: "header.history" },
  { current: "details", href: ACCOUNT_DETAILS_PATH, label: "header.details" },
  { current: "admin", href: ADMIN_PATH, label: "header.admin", adminOnly: true },
];

/** The quiet Sign out form: in the row it ends the row and is flush with the gutter (`flush="end"`); in the Menu's panel nothing is flush. */
function SignOutButton({ label, flush }: { label: string; flush?: "end" }) {
  return (
    <form action={signOut}>
      <Button kind="quiet" nowrap type="submit" {...(flush ? { flush } : {})}>
        {label}
      </Button>
    </form>
  );
}

/**
 * The header every public page opens with: the farm's name, then the language switch. Signed in, the
 * header reads the session itself: the account links (Your meal, Upcoming weeks, History, then Admin for
 * admins only; `current` marks the one showing as the page), the language switch, then Sign out. At 720px
 * and wider they are a row; below it they fold into a Menu button whose panel holds the same links, Sign out,
 * and the switch below a divider (issue 155). Signed out,
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
  current?: Current;
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
  const links = (full: boolean) =>
    ACCOUNT_LINKS.filter((link) => !link.adminOnly || member?.role === "admin").map((link) => (
      <Button key={link.current} kind="secondary" nowrap full={full} href={link.href} current={current === link.current}>
        {t(link.label)}
      </Button>
    ));
  return (
    <SiteBar as="header">
      <a href="/" className="flex flex-col">
        <span className="font-display text-wordmark text-teal uppercase">{t("brand.name")}</span>
        <span className="text-byline text-ink-muted">{t("brand.byline")}</span>
      </a>
      {member ? (
        <>
          <div className="account-row ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 lg:flex-nowrap">
            <nav aria-label={t("header.account")} className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:flex-nowrap">
              {links(false)}
            </nav>
            {switcher}
            <SignOutButton label={t("home.signOut")} flush="end" />
          </div>
          <div className="account-menu ml-auto">
            <MenuButton label={t("header.menu")}>
              <nav aria-label={t("header.account")} className="flex flex-col gap-2">
                {links(true)}
              </nav>
              <SignOutButton label={t("home.signOut")} />
              <div className="border-t border-divider pt-2">{switcher}</div>
            </MenuButton>
          </div>
        </>
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
