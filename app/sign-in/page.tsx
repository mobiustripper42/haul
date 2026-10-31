import { getTranslator } from "../language";
import { requestCode } from "./actions";

/** The `limited` notice's minutes: an integer from 1 to 60, anything else shows no notice. */
const limitedMinutes = (value: string | undefined): number | null => {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const minutes = Number(value);
  return minutes <= 60 ? minutes : null;
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const [t, { limited, error }] = await Promise.all([getTranslator(), searchParams]);
  const minutes = limitedMinutes(limited);
  return (
    <main className="page-narrow">
      <section className="card">
        <h1 className="font-display text-heading text-teal">{t("signIn.title")}</h1>
        {minutes !== null && (
          <p role="alert" className="notice notice-lock">
            {t("signIn.limited", { minutes })}
          </p>
        )}
        {error === "expired" && (
          <p role="alert" className="notice notice-clock">
            {t("signIn.stepExpired")}
          </p>
        )}
        <form action={requestCode} className="flex flex-col gap-6">
          <p>
            <label htmlFor="email" className="mb-2 block text-field-label">
              {t("signIn.emailLabel")}
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className="field" />
          </p>
          <button type="submit" className="btn-primary w-full">
            {t("signIn.sendCode")}
          </button>
        </form>
      </section>
    </main>
  );
}
