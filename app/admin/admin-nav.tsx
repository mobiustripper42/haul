import { Button } from "../../components/ui/button";
import { getTranslator } from "../language";
import { ADMIN_PATH, ADMIN_WEEKS_PATH } from "../paths";

/**
 * The admin screens' links, under the header: the header's single Admin button cannot name two screens. The
 * current screen's link is marked as the page showing. Called inline, `{await AdminNav({ current })}`, as
 * `SiteHeader` is.
 */
export async function AdminNav({ current }: { current: "members" | "weeks" }) {
  const t = await getTranslator();
  return (
    <nav aria-label={t("header.admin")} className="flex flex-wrap gap-2">
      <Button kind="secondary" href={ADMIN_PATH} current={current === "members"}>
        {t("admin.nav.members")}
      </Button>
      <Button kind="secondary" href={ADMIN_WEEKS_PATH} current={current === "weeks"}>
        {t("admin.nav.weeks")}
      </Button>
    </nav>
  );
}
