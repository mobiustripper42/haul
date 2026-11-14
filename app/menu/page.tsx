import type { ReactNode } from "react";
import { currentWeekMenu } from "@core/menu-run.js";
import { menuSections } from "@core/menus.js";
import { formatUsdWhole } from "@core/money.js";
import { pickupWhereLine, weekTitle } from "@core/pickup-week.js";
import { cheapestChoices, priceOfChoices, requireSupperClub } from "@core/products.js";
import { BulletList } from "../../components/ui/bullet-list";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Eyebrow } from "../../components/ui/eyebrow";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Panel } from "../../components/ui/panel";
import { Shell } from "../../components/ui/shell";
import { getLanguage, getTranslator } from "../language";
import { titled } from "../page-title";
import { getRepository } from "../services";
import { SiteHeader } from "../site-header";
import { SUPPER_CLUB_PATH } from "../supper-club/paths";

export const generateMetadata = titled("menu.title");

/**
 * The public menu page (issue 141, AC7), no sign-in: the current week's menu once its email has gone out, and "The menu
 * is on the way" until then, a week with no menu and no current week alike. Both end with the join panel.
 */
export default async function MenuPage(): Promise<ReactNode> {
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const repo = getRepository();
  const product = await requireSupperClub(repo);
  const current = await currentWeekMenu(repo, product, new Date());
  const shown = current !== null && current.menu !== null && current.sentAt !== null ? { week: current.week, menu: current.menu } : null;
  const { choices, sizeName } = cheapestChoices(product);
  const price = formatUsdWhole(priceOfChoices(product, choices));

  return (
    <>
      {await SiteHeader({ account: "sign-in" })}
      <Shell width="page">
        <div className="flex w-full min-w-0 flex-col gap-5">
          {shown ? (
            <>
              <div className="flex flex-col gap-2">
                <Eyebrow tone="muted">{t("menu.eyebrow")}</Eyebrow>
                <Heading>{t("menu.heading", { week: weekTitle(t, shown.week, language) })}</Heading>
              </div>
              <p>{t("menu.pickup", { pickup: pickupWhereLine(t, shown.week, language) })}</p>
              <div className="flex flex-col gap-4 lg:flex-row">
                {menuSections(product, shown.menu).map((section) => (
                  <div key={section.name} className="min-w-0 flex-1">
                    <Card width="fill">
                      <Heading level={2}>{section.name}</Heading>
                      <BulletList items={section.lines} />
                    </Card>
                  </div>
                ))}
              </div>
              <Hint>{t("menu.allergens")}</Hint>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Eyebrow tone="muted">{t("menu.eyebrow")}</Eyebrow>
                <Heading>{t("menu.onTheWay")}</Heading>
              </div>
              <p>{t("menu.onTheWayBody")}</p>
            </>
          )}
          <Panel title={t("menu.join.title")}>
            <p>{sizeName === null ? t("menu.join.bodyNoSize", { price }) : t("menu.join.body", { price, size: sizeName })}</p>
            <Button kind="primary" href={SUPPER_CLUB_PATH}>
              {t("supperClub.joinTitle")}
            </Button>
          </Panel>
        </div>
      </Shell>
    </>
  );
}
