// Issue 271: the page for a URL the app has no page for, and for a page that calls `notFound()` (a missing menu, member or
// menu-email link). Called inline, `await SiteHeader(...)`, as `LegalPage` is, because `react-dom/server` cannot render an
// async component written as JSX (`app/site-header.tsx`).
//
// The header is the Member interface for everyone, an admin included, though the page cannot tell an admin URL from any other
// that has no page: reading the URL to pick the interface is a cost the guess of a few a year does not earn. An admin who lands
// here is one tap from Admin, through the header's switch.
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Heading } from "../components/ui/heading";
import { Shell } from "../components/ui/shell";
import { homePath } from "./home-path";
import { getTranslator } from "./language";
import { titled } from "./page-title";
import { ACCOUNT_PATH } from "./paths";
import { SiteHeader } from "./site-header";

export const generateMetadata = titled("notFound.title");

/** The title, one line and one link onward, to the Supper Club when signed out and to Your account when signed in. */
export default async function NotFound() {
  const t = await getTranslator();
  const home = await homePath();
  return (
    <>
      {await SiteHeader({ account: "sign-in" })}
      <Shell>
        <Card>
          <Heading>{t("notFound.title")}</Heading>
          <p>{t("notFound.line")}</p>
          <Button kind="secondary" href={home}>
            {t(home === ACCOUNT_PATH ? "notFound.toAccount" : "notFound.toSupperClub")}
          </Button>
        </Card>
      </Shell>
    </>
  );
}
