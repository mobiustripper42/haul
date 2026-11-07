import { PRIVACY_PATH, TERMS_PATH } from "@core/legal-documents.js";
import { Button } from "../components/ui/button";
import { SiteBar } from "../components/ui/site-bar";
import { getTranslator } from "./language";
import { getFarmContactEmail } from "./services";

/**
 * The footer every page ends with: the farm's address, then Terms, Privacy and Contact (a `mailto:` the
 * farm's address, left out while `FARM_CONTACT_EMAIL` is unset). Rendered once by the root layout, which
 * reads no session (DEC-018). Called inline, `{await SiteFooter()}`, as `SiteHeader` is.
 */
export async function SiteFooter() {
  const t = await getTranslator();
  const contact = getFarmContactEmail();
  return (
    <SiteBar as="footer">
      <p className="text-small text-ink-muted">{t("brand.address")}</p>
      <div className="flex items-center gap-4">
        <Button kind="quiet" href={TERMS_PATH}>
          {t("footer.terms")}
        </Button>
        <Button kind="quiet" href={PRIVACY_PATH}>
          {t("footer.privacy")}
        </Button>
        {contact !== undefined && (
          <Button kind="quiet" href={`mailto:${contact}`}>
            {t("footer.contact")}
          </Button>
        )}
      </div>
    </SiteBar>
  );
}
