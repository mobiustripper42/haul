import { LegalPage } from "../legal-page";
import { getTranslator } from "../language";

/** `/privacy`: the Privacy policy, open to everyone. */
export default async function Privacy() {
  const t = await getTranslator();
  return await LegalPage({ title: t("legal.privacy.title"), text: t("legal.privacy.text") });
}
