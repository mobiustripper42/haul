import { LegalPage } from "../legal-page";
import { getTranslator } from "../language";
import { titled } from "../page-title";

export const generateMetadata = titled("legal.privacy.title");

/** `/privacy`: the Privacy policy, open to everyone. */
export default async function Privacy() {
  const t = await getTranslator();
  return await LegalPage({ title: t("legal.privacy.title"), text: t("legal.privacy.text") });
}
