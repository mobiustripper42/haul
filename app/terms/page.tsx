import { LegalPage } from "../legal-page";
import { getTranslator } from "../language";
import { titled } from "../page-title";

export const generateMetadata = titled("legal.terms.title");

/** `/terms`: the Terms of service, open to everyone. */
export default async function Terms() {
  const t = await getTranslator();
  return await LegalPage({ title: t("legal.terms.title"), text: t("legal.terms.text") });
}
