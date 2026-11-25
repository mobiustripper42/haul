import type { MessageKey } from "@core/i18n.js";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../components/ui/button";
import { MenuDrawer } from "../components/ui/menu-drawer";
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

/** The admin links in order: the Admin interface's links, in the bar and in the drawer (issue 266). */
const ADMIN_LINKS: readonly NavLink[] = [
  { current: "admin-members", href: ADMIN_PATH, label: "admin.nav.members" },
  { current: "admin-menus", href: ADMIN_MENUS_PATH, label: "admin.nav.menus" },
  { current: "admin-weeks", href: ADMIN_WEEKS_PATH, label: "admin.nav.weeks" },
  { current: "admin-lists", href: ADMIN_LISTS_PATH, label: "admin.nav.lists" },
];

/** The Sign out form: a menu entry, the one that is a `<button>`, so it reads muted (issue 159). In the bar it is set apart from the links, by `apart`, unless the switch before it does that; at the drawer's foot it is a full row. */
function SignOutButton({ label, inBar, apart }: { label: string; inBar?: true; apart?: true }) {
  return (
    <form action={signOut} {...(inBar && apart ? { className: "ml-2" } : {})}>
      <Button kind="menu" nowrap type="submit" {...(inBar ? {} : { full: true })}>
        {label}
      </Button>
    </form>
  );
}

/** The switch between the two interfaces an admin has: a secondary link, drawn once and used in the bar and at the drawer's foot. In the bar it carries the `ml-2` that sets Sign out apart, and Sign out follows at the bar's own gap. Never marked as the page showing (issue 266). */
function SwitchLink({ href, label, inBar }: { href: string; label: string; inBar?: true }) {
  const button = (
    <Button kind="secondary" nowrap href={href} {...(inBar ? {} : { full: true })}>
      {label}
    </Button>
  );
  return inBar ? <div className="ml-2">{button}</div> : button;
}

/**
 * The header every public page opens with: the farm's name. Signed in, the header reads the session
 * itself and is one bar (issue 159): at 1024px and wider the member links (Your account, Upcoming weeks,
 * History, and, for a member with no active subscription, Supper Club and This week's menu before them, issue 260), and Sign out; below it all of
 * it is in a drawer from the right, with Sign out at its foot. An admin sees one interface at a time (issue 266): on a page whose
 * `current` starts `admin-` the Admin interface, Members, Menus, Weeks and Weekly lists, and on every other page the member links,
 * each followed by a switch to the other interface, right before Sign out. `current` names the page showing: its link is marked
 * in both. Signed out, `account` adds
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
  // One value decides the interface: an admin on a page that marks itself an admin page (issue 266).
  const adminInterface = member?.role === "admin" && current?.startsWith("admin-") === true;
  const wordmark = <Wordmark name={t("brand.name")} byline={t("brand.byline")} href={adminInterface ? ADMIN_PATH : "/"} />;
  if (member) {
    const repo = getRepository();
    const product = await requireSupperClub(repo);
    // The read the Supper Club page uses to decide who is already a member, so the links show exactly when that page lets them join (issue 260).
    const active = await repo.findActiveSubscription(member.id, product.id);
    const memberLinks = active ? MEMBER_LINKS : [...NO_SUBSCRIPTION_LINKS, ...MEMBER_LINKS];
    const pageLinks = adminInterface ? ADMIN_LINKS : memberLinks;
    // The switch crosses to the other interface: from the Admin one to Your account, from the Member one to Members.
    const switchTo = adminInterface ? { href: ACCOUNT_PATH, label: t("header.yourAccount") } : { href: ADMIN_PATH, label: t("header.admin") };
    return (
      <SiteBar as="header" wide>
        {wordmark}
        <div className="menu-bar ml-auto">
          <nav aria-label={t("header.account")} className="flex items-center gap-1">
            {links(pageLinks, false)}
          </nav>
          {admin ? <SwitchLink {...switchTo} inBar /> : null}
          <SignOutButton label={t("home.signOut")} inBar apart={admin ? undefined : true} />
        </div>
        <div className="menu-drawer-slot ml-auto">
          <MenuDrawer
            label={t("header.menu")}
            closeLabel={t("header.closeMenu")}
            heading={<span className="font-display text-wordmark text-teal uppercase">{t("brand.name")}</span>}
            foot={
              <>
                {admin ? <SwitchLink {...switchTo} /> : null}
                <SignOutButton label={t("home.signOut")} />
              </>
            }
          >
            <nav aria-label={t("header.account")} className="flex flex-col gap-1">
              {links(pageLinks, true)}
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
