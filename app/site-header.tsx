import { Button } from "../components/ui/button";
import { SiteBar } from "../components/ui/site-bar";
import { getTranslator } from "./language";
import { ADMIN_PATH } from "./paths";
import { getSignedInMember } from "./session";
import { signOut } from "./sign-in/actions";
import { PANE_SIGN_IN_PAGES } from "./supper-club/paths";

/**
 * The header every public page opens with: the farm's name. Signed in, the header reads the session
 * itself: an Admin button (admins only; `current: "admin"` marks it as the page showing), then Sign out.
 * Signed out, `account` adds a link after the name: "sign-in" a secondary Sign in to the Supper Club's
 * sign-in pane, "sign-in-current" the same link marked as the page showing, "none" nothing. `wideOnly`
 * hides a Sign in at widths below `lg`, for a pane page whose card already is the sign-in. Called inline,
 * `{await SiteHeader({ account })}`, as `JoinPage` is.
 */
export async function SiteHeader({
  account,
  wideOnly,
  current,
}: {
  account: "none" | "sign-in" | "sign-in-current";
  wideOnly?: boolean;
  current?: "admin";
}) {
  const [t, member] = await Promise.all([getTranslator(), getSignedInMember()]);
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
        <div className="flex items-center gap-4">
          {member.role === "admin" && (
            <Button kind="secondary" href={ADMIN_PATH} current={current === "admin"}>
              {t("header.admin")}
            </Button>
          )}
          <form action={signOut}>
            <Button kind="quiet" type="submit" flush="end">
              {t("home.signOut")}
            </Button>
          </form>
        </div>
      ) : account === "none" ? null : wideOnly ? (
        <div className="wide-only">{signIn}</div>
      ) : (
        signIn
      )}
    </SiteBar>
  );
}
