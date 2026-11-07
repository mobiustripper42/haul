import { LegalPage } from "../legal-page";
import { getTranslator } from "../language";

/** `/terms`: the Terms of service, open to everyone. */
export default async function Terms() {
  const t = await getTranslator();
  return await LegalPage({ title: t("legal.terms.title"), text: t("legal.terms.text") });
}
