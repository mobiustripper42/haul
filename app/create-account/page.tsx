import { cookies } from "next/headers";
import { LANGUAGES, isLanguage } from "@core/i18n.js";
import type { AccountField } from "@core/create-account.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { FieldError } from "../../components/ui/field-error";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Input } from "../../components/ui/input";
import { Notice } from "../../components/ui/notice";
import { Select } from "../../components/ui/select";
import { Shell } from "../../components/ui/shell";
import { getLanguage, getTranslator } from "../language";
import { ACCOUNT_DRAFT_COOKIE } from "../session";
import { limitedMinutes } from "../sign-in/shared";
import { requestAccountCode } from "./actions";

const ERROR_KEYS = {
  firstName: "createAccount.error.firstName",
  lastName: "createAccount.error.lastName",
  email: "createAccount.error.email",
  phone: "createAccount.error.phone",
} as const satisfies Record<AccountField, string>;

type Draft = Partial<Record<AccountField | "language", string>>;

/** The values a failed request entered, or nothing: a cookie that is missing, not JSON or not an object refills nothing. */
function readDraft(raw: string | undefined): Draft {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const draft: Draft = {};
    for (const key of ["firstName", "lastName", "email", "phone", "language"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string") draft[key] = value;
    }
    return draft;
  } catch {
    return {};
  }
}

export default async function CreateAccount({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const [t, language, { limited, error }, cookieStore] = await Promise.all([
    getTranslator(),
    getLanguage(),
    searchParams,
    cookies(),
  ]);
  const minutes = limitedMinutes(limited);
  // The form refills only after a failed request: `error` is present, whatever it names.
  const draft = error === undefined ? {} : readDraft(cookieStore.get(ACCOUNT_DRAFT_COOKIE)?.value);
  const failing = new Set(error?.split(","));
  const fieldError = (field: AccountField) =>
    failing.has(field) ? <FieldError id={`${field}-error`}>{t(ERROR_KEYS[field])}</FieldError> : null;
  /** What an input is described by: its error line, then its help line. */
  const described = (field: AccountField, help?: string) =>
    [failing.has(field) ? `${field}-error` : null, help].filter(Boolean).join(" ") || undefined;
  const invalid = (field: AccountField) => (failing.has(field) ? true : undefined);

  return (
    <Shell>
      <Card>
        {minutes !== null && <Notice icon="lock">{t("signIn.limited", { minutes })}</Notice>}
        {error === "expired" && <Notice icon="clock">{t("signIn.stepExpired")}</Notice>}
        <Heading>{t("createAccount.title")}</Heading>
        <form action={requestAccountCode} noValidate className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-4">
            <div className="min-w-0 flex-1 basis-36">
              <Field label={t("createAccount.firstName")} htmlFor="firstName">
                <Input
                  id="firstName"
                  name="firstName"
                  autoComplete="given-name"
                  defaultValue={draft.firstName ?? ""}
                  aria-invalid={invalid("firstName")}
                  aria-describedby={described("firstName")}
                />
                {fieldError("firstName")}
              </Field>
            </div>
            <div className="min-w-0 flex-1 basis-36">
              <Field label={t("createAccount.lastName")} htmlFor="lastName">
                <Input
                  id="lastName"
                  name="lastName"
                  autoComplete="family-name"
                  defaultValue={draft.lastName ?? ""}
                  aria-invalid={invalid("lastName")}
                  aria-describedby={described("lastName")}
                />
                {fieldError("lastName")}
              </Field>
            </div>
          </div>
          <Field label={t("signIn.emailLabel")} htmlFor="email" help={t("createAccount.emailHelp")}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={draft.email ?? ""}
              aria-invalid={invalid("email")}
              aria-describedby={described("email", "email-help")}
            />
            {fieldError("email")}
          </Field>
          <Field label={t("createAccount.phone")} htmlFor="phone" help={t("createAccount.phoneHelp")}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={draft.phone ?? ""}
              aria-invalid={invalid("phone")}
              aria-describedby={described("phone", "phone-help")}
            />
            {fieldError("phone")}
          </Field>
          <Field label={t("createAccount.language")} htmlFor="language">
            <Select
              id="language"
              name="language"
              options={Object.entries(LANGUAGES).map(([code, { name }]) => ({ value: code, label: name }))}
              defaultValue={isLanguage(draft.language) ? draft.language : language}
            />
          </Field>
          <Button kind="primary" full type="submit">
            {t("signIn.sendCode")}
          </Button>
        </form>
        <Hint>
          {t("createAccount.haveAccount")}{" "}
          <Button kind="quiet" href="/sign-in">
            {t("home.signIn")}
          </Button>
        </Hint>
      </Card>
    </Shell>
  );
}
