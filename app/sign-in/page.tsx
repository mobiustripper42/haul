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
    <main>
      <h1>{t("signIn.title")}</h1>
      {minutes !== null && <p role="alert">{t("signIn.limited", { minutes })}</p>}
      {error === "expired" && <p role="alert">{t("signIn.stepExpired")}</p>}
      <form action={requestCode}>
        <p>
          <label htmlFor="email">{t("signIn.emailLabel")}</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </p>
        <button type="submit">{t("signIn.sendCode")}</button>
      </form>
    </main>
  );
}
