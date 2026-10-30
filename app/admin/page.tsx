import { getTranslator } from "../language";
import { requireAdmin } from "../session";

export default async function Admin() {
  await requireAdmin();
  const t = await getTranslator();
  return (
    <main>
      <h1>{t("admin.title")}</h1>
      <p>
        <a href="/">{t("admin.memberPage")}</a>
      </p>
    </main>
  );
}
