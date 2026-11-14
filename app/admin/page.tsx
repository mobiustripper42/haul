import { OPENING_SORT, sortSubscribers } from "@core/member-list.js";
import { requireSupperClub } from "@core/products.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Shell } from "../../components/ui/shell";
import { getLanguage, getTranslator } from "../language";
import { getRepository } from "../services";
import { requireAdmin } from "../session";
import { SiteHeader } from "../site-header";
import { AdminNav } from "./admin-nav";
import { MembersList } from "./members-list";
import { titled } from "../page-title";

export const generateMetadata = titled("admin.members.title");

/**
 * The Supper Club's members: who holds an active or cancelled subscription, with search and sorting in the browser and a link
 * to the spreadsheet. The count is the held spots, so it matches what closes signup and can run above the rows
 * while a signup is mid-payment.
 */
export default async function Admin() {
  await requireAdmin();
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const [held, subscribers] = await Promise.all([repo.countHeldSpots(product.id), repo.listSubscribers(product.id)]);

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {await AdminNav({ current: "members" })}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Heading>{t("admin.members.title")}</Heading>
              <Hint>{t("admin.members.taken", { n: held, cap: product.cap })}</Hint>
            </div>
            <Button kind="secondary" href="/admin/members.csv">
              {t("admin.members.download")}
            </Button>
          </div>
          <Card width="fill">
            {subscribers.length === 0 ? (
              <>
                <Heading level={2}>{t("admin.members.emptyTitle")}</Heading>
                <p className="text-ink-muted">{t("admin.members.emptyBody")}</p>
              </>
            ) : (
              <MembersList
                rows={sortSubscribers(subscribers, OPENING_SORT)}
                language={language}
                text={{
                  search: t("admin.members.search"),
                  searchPlaceholder: t("admin.members.searchPlaceholder"),
                  noMatch: t("admin.members.noMatch", { q: "{q}" }),
                  columns: {
                    name: t("admin.members.name"),
                    email: t("admin.members.email"),
                    phone: t("admin.members.phone"),
                    meal: t("admin.members.meal"),
                    joined: t("admin.members.joined"),
                    status: t("admin.members.status"),
                  },
                  status: { active: t("account.active"), cancelled: t("account.cancelled") },
                  refundOwed: t("admin.members.refundOwed"),
                  sortBy: t("admin.members.sortBy"),
                  sortLabels: {
                    name: t("admin.members.name"),
                    joined: t("admin.members.joined"),
                    meal: t("admin.members.meal"),
                    status: t("admin.members.status"),
                  },
                  joinedLine: t("admin.members.joinedLine", { meal: "{meal}", date: "{date}" }),
                }}
              />
            )}
          </Card>
        </div>
      </Shell>
    </>
  );
}
