import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Shell } from "../../components/ui/shell";
import { getTranslator } from "../language";
import { requireAdmin } from "../session";

export default async function Admin() {
  await requireAdmin();
  const t = await getTranslator();
  return (
    <Shell>
      <Card>
        <Heading>{t("admin.title")}</Heading>
        <p>
          <a href="/">{t("admin.memberPage")}</a>
        </p>
      </Card>
    </Shell>
  );
}
