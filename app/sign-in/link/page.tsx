import { redirect } from "next/navigation";
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
    <main className="page-narrow">
      <section className="card">
        <h1 className="font-display text-heading text-teal">{t("signIn.title")}</h1>
        <p className="text-ink-muted">{t("signIn.linkPrompt")}</p>
        <form action={signInWithLink}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn-primary w-full">
            {t("signIn.submitCode")}
          </button>
        </form>
      </section>
    </main>
  );
}
