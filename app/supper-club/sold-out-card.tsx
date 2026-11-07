import type { Translator } from "@core/i18n.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Hint } from "../../components/ui/hint";
import { Notice } from "../../components/ui/notice";
import { FARM_SITE_URL } from "./paths";

/**
 * What stands in the Join card's place when the held spots reach the cap. The notice shows only when a
 * signup was refused on the way here (`payError=soldout`); the "Questions?" line only when the farm has an
 * email set.
 */
export function SoldOutCard({ t, notice, email }: { t: Translator; notice: boolean; email: string | undefined }) {
  return (
    <Card width="fill">
      {notice && <Notice icon="alert">{t("supperClub.soldOut.notice")}</Notice>}
      <p className="font-display text-heading text-teal">{t("supperClub.soldOut.title")}</p>
      <p>{t("supperClub.soldOut.body")}</p>
      {email && <Hint>{t("supperClub.soldOut.contact", { email })}</Hint>}
      <Button kind="secondary" href={FARM_SITE_URL}>
        {t("supperClub.done.back")}
      </Button>
    </Card>
  );
}
