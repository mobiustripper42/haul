import { redirect } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Shell } from "../../../components/ui/shell";
import { getTranslator } from "../../language";
import { signInWithLink } from "../actions";

/**
 * Where the emailed link lands. Opening it redeems nothing, so a mail scanner that fetches the link
 * cannot spend it: the token is spent by the button.
 */
export default async function SignInLink({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/sign-in?error=link");

  const t = await getTranslator();
  return (
    <Shell>
      <Card>
        <Heading>{t("signIn.title")}</Heading>
        <p className="text-ink-muted">{t("signIn.linkPrompt")}</p>
        <form action={signInWithLink}>
          <input type="hidden" name="token" value={token} />
          <Button kind="primary" full type="submit">
            {t("signIn.submitCode")}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
