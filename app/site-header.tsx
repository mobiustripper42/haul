import type { MessageKey } from "@core/i18n.js";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../components/ui/button";
import { Eyebrow } from "../components/ui/eyebrow";
import { MenuDrawer } from "../components/ui/menu-drawer";
import { MenuGroup } from "../components/ui/menu-group";
import { MenuScript } from "../components/ui/menu-script";
import { SiteBar } from "../components/ui/site-bar";
import { Wordmark } from "../components/ui/wordmark";
import { getTranslator } from "./language";
import {
  ACCOUNT_HISTORY_PATH,
  ACCOUNT_PATH,
  ACCOUNT_WEEKS_PATH,
  ADMIN_LISTS_PATH,
  ADMIN_MENUS_PATH,
  ADMIN_PATH,
  ADMIN_WEEKS_PATH,
  MENU_PATH,
} from "./paths";
import { getRepository } from "./services";
import { getSignedInMember } from "./session";
import { signOut } from "./sign-in/actions";
import { PANE_SIGN_IN_PAGES, SUPPER_CLUB_PATH } from "./supper-club/paths";

type Current = "supper-club" | "menu" | "account" | "weeks" | "admin-members" | "admin-menus" | "admin-weeks" | "admin-lists";

/** `current` is the page the link marks; History has none, for the server never sees the part of its address after `#` (issue 243). */
type NavLink = { current?: Current; href: string; label: MessageKey };

/** The links of a member with no active subscription (issue 260), drawn in front of `MEMBER_LINKS`, in the bar and in the drawer. */
const NO_SUBSCRIPTION_LINKS: readonly NavLink[] = [
  { current: "supper-club", href: SUPPER_CLUB_PATH, label: "header.supperClub" },
  { current: "menu", href: MENU_PATH, label: "header.thisWeeksMenu" },
];

/** The member links in order, drawn twice from here: in the bar, and in the drawer. */
const MEMBER_LINKS: readonly NavLink[] = [
  { current: "account", href: ACCOUNT_PATH, label: "header.yourAccount" },
  { current: "weeks", href: ACCOUNT_WEEKS_PATH, label: "header.weeks" },
  { href: ACCOUNT_HISTORY_PATH, label: "header.history" },
];

/** The admin links in order, for admins only: in the bar's Admin group, and openly at the top of the drawer under an Admin heading, set off from the member links by a rule. */
const ADMIN_LINKS: readonly NavLink[] = [
  { current: "admin-members", href: ADMIN_PATH, label: "admin.nav.members" },
  { current: "admin-menus", href: ADMIN_MENUS_PATH, label: "admin.nav.menus" },
  { current: "admin-weeks", href: ADMIN_WEEKS_PATH, label: "admin.nav.weeks" },
  { current: "admin-lists", href: ADMIN_LISTS_PATH, label: "admin.nav.lists" },
];

/** The Sign out form: a menu entry, the one that is a `<button>`, so it reads muted (issue 159). In the bar it is set apart from the links; at the drawer's foot it is a full row. */
function SignOutButton({ label, inBar }: { label: string; inBar?: true }) {
  return (
    <form action={signOut} {...(inBar ? { className: "ml-2" } : {})}>
      <Button kind="menu" nowrap type="submit" {...(inBar ? {} : { full: true })}>
        {label}
      </Button>
    </form>
  );
}

/**
 * The header every public page opens with: the farm's name. Signed in, the header reads the session
 * itself and is one bar (issue 159): at 1024px and wider the member links (Your account, Upcoming weeks,
 * History, and, for a member with no active subscription, Supper Club and This week's menu before them, issue 260), for an admin an Admin group (Members, Menus, Weeks, Weekly lists), and Sign out; below it all of
 * it is in a drawer from the right, with Sign out at its foot. `current` names the page showing: its link is marked
 * in both, and on an admin page so is the Admin group. Signed out, `account` adds
 * a link after the name: "sign-in" a secondary Sign in to the Supper Club's sign-in pane,
 * "sign-in-current" the same link marked as the page showing, "none" nothing. `wideOnly` hides a Sign in
 * at widths below `lg`, for a pane page whose card already is the sign-in. Called inline,
 * `{await SiteHeader({ account })}`, as `JoinPage` is.
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
  const signIn = (
    <Button kind="secondary" href={PANE_SIGN_IN_PAGES.start} current={account === "sign-in-current"}>
      {t("home.signIn")}
    </Button>
  );
  const links = (list: readonly NavLink[], full: boolean) =>
    list.map((link) => (
      <Button key={link.href} kind="menu" nowrap full={full} href={link.href} current={link.current !== undefined && current === link.current}>
        {t(link.label)}
      </Button>
    ));
  const admin = member?.role === "admin";
  // The read the Supper Club page uses to decide who is already a member, so the links show exactly when that page lets them join (issue 260).
  const subscribed = member ? (await getRepository().findActiveSubscription(member.id, (await requireSupperClub(getRepository())).id)) !== null : false;
  const memberLinks = subscribed ? MEMBER_LINKS : [...NO_SUBSCRIPTION_LINKS, ...MEMBER_LINKS];
  const wordmark = <Wordmark name={t("brand.name")} byline={t("brand.byline")} />;
  if (member) {
    return (
      <SiteBar as="header" wide>
        {wordmark}
        <div className="menu-bar ml-auto">
          <nav aria-label={t("header.account")} className="flex items-center gap-1">
            {links(memberLinks, false)}
            {admin ? (
              <MenuGroup label={t("header.admin")} active={current?.startsWith("admin-") === true}>
                {links(ADMIN_LINKS, true)}
              </MenuGroup>
            ) : null}
          </nav>
          <SignOutButton label={t("home.signOut")} inBar />
        </div>
        <div className="menu-drawer-slot ml-auto">
          <MenuDrawer
            label={t("header.menu")}
            closeLabel={t("header.closeMenu")}
            heading={<span className="font-display text-wordmark text-teal uppercase">{t("brand.name")}</span>}
            foot={<SignOutButton label={t("home.signOut")} />}
          >
            <nav aria-label={t("header.account")} className="flex flex-col gap-1">
              {admin ? (
                <div className="mb-1 flex flex-col gap-1 border-b border-divider pb-2">
                  <div className="px-3">
                    <Eyebrow tone="muted">{t("header.admin")}</Eyebrow>
                  </div>
                  {links(ADMIN_LINKS, true)}
                </div>
              ) : null}
              {links(memberLinks, true)}
            </nav>
          </MenuDrawer>
        </div>
        <MenuScript />
      </SiteBar>
    );
  }
  return (
    <SiteBar as="header">
      {wordmark}
      {account === "none" ? null : wideOnly ? <div className="wide-only">{signIn}</div> : signIn}
    </SiteBar>
  );
}
