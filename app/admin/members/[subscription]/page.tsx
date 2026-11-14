import { notFound } from "next/navigation";
import { memberDisplayName } from "@core/members.js";
import { listedWeekTitle } from "@core/pickup-week.js";
import { requireSupperClub } from "@core/products.js";
import { subscriberName } from "@core/member-list.js";
import { Button } from "../../../../components/ui/button";
import { ButtonRow } from "../../../../components/ui/button-row";
import { Card } from "../../../../components/ui/card";
import { Heading } from "../../../../components/ui/heading";
import { Shell } from "../../../../components/ui/shell";
import { loadLastPickup } from "../../../account/weeks/rows";
import { getLanguage, getTranslator } from "../../../language";
import { titled } from "../../../page-title";
import { ADMIN_MEMBER_CANCEL_OPEN, ADMIN_PATH, adminMemberPath } from "../../../paths";
import { getRepository } from "../../../services";
import { requireAdmin } from "../../../session";
import { SiteHeader } from "../../../site-header";
import { SUBSCRIPTION_BADGES, SubscriptionStatus } from "../../../subscription-badges";
import { AdminNav } from "../../admin-nav";
import { cancelForMember } from "./actions";

export const generateMetadata = titled("admin.members.title");

/**
 * An admin's page for one subscription (issue 139), cut down to what a cancel needs: the member's name, its status
 * badge, and the Cancel button. With `?cancel=1` and an active subscription, the confirm card opens above it, naming the
 * last pickup and any week credit to refund by hand (DEC-005); a cancelled subscription shows no button. The row is found
 * in the members list, so an id that is not there (unknown, pending, another product's) is Next's not-found page.
 */
export default async function AdminMember({
  params,
  searchParams,
}: {
  params: Promise<{ subscription: string }>;
  searchParams?: Promise<{ cancel?: string }>;
}) {
  await requireAdmin();
  const [{ subscription }, query] = await Promise.all([params, searchParams]);
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const row = (await repo.listSubscribers(product.id)).find((subscriber) => subscriber.subscriptionId === subscription);
  if (!row) notFound();
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const active = row.status === "active";
  const confirming = active && query?.cancel === ADMIN_MEMBER_CANCEL_OPEN;
  // The confirm reads the member's weeks only when it is open: the last pickup still to come, and the week credits to refund.
  const [last, ledger] = confirming
    ? await Promise.all([loadLastPickup(product, subscription, new Date()), repo.listMemberWeeks(subscription)])
    : [null, null];
  const stillToCome = last !== null && !last.passed ? last.week : null;

  return (
    <>
      {await SiteHeader({ account: "none", current: "admin" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {await AdminNav({ current: "members" })}
          <div className="flex">
            <Button kind="quiet" href={ADMIN_PATH} back flush>
              {t("admin.member.back")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Heading>{subscriberName(row)}</Heading>
            <SubscriptionStatus
              status={row.status}
              refundOwed={row.refundOwed}
              cardDeclined={row.cardDeclined}
              words={{ status: t(SUBSCRIPTION_BADGES[row.status].key), refundOwed: t("admin.members.refundOwed"), cardDeclined: t("admin.members.cardDeclined") }}
            />
          </div>
          {confirming && (
            <Card width="fill">
              <Heading level={2}>{t("admin.member.cancelTitle", { name: memberDisplayName(row) ?? row.email })}</Heading>
              <p>
                {stillToCome && `${t("admin.member.lastPickup", { week: listedWeekTitle(t, stillToCome, language) })} `}
                {t("admin.member.nothingMore")}
              </p>
              {ledger !== null && ledger.weekCredits.length > 0 && <p>{t("admin.member.credit")}</p>}
              <form action={cancelForMember}>
                <input type="hidden" name="subscription" value={subscription} />
                <ButtonRow>
                  <Button kind="primary" type="submit">
                    {t("admin.member.confirm")}
                  </Button>
                  <Button kind="secondary" href={adminMemberPath(subscription)}>
                    {t("admin.member.keep")}
                  </Button>
                </ButtonRow>
              </form>
            </Card>
          )}
          {active && !confirming && (
            <div className="flex">
              <Button kind="secondary" href={`${adminMemberPath(subscription)}?cancel=${ADMIN_MEMBER_CANCEL_OPEN}`}>
                {t("admin.member.cancelFor")}
              </Button>
            </div>
          )}
        </div>
      </Shell>
    </>
  );
}
