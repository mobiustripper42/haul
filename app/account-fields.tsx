// The five fields Create Account and Your details both render (issue 156): first and last name, email, phone and
// language for emails, with their limits and their error lines. Called inline with `await`, as `CodeStep` is,
// because `findAll` does not enter a component (app/screen-test-helpers.ts). A form wraps them and adds its button.
import type { ReactNode } from "react";
import { ACCOUNT_LIMITS, type AccountField } from "@core/create-account.js";
import { LANGUAGES, isLanguage, type MessageKey } from "@core/i18n.js";
import { Field } from "../components/ui/field";
import { FieldError } from "../components/ui/field-error";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { getLanguage, getTranslator } from "./language";

const ERROR_KEYS = {
  firstName: "createAccount.error.firstName",
  lastName: "createAccount.error.lastName",
  email: "createAccount.error.email",
  phone: "createAccount.error.phone",
} as const satisfies Record<AccountField, string>;

export type AccountValues = Partial<Record<AccountField | "language", string>>;

/** The values a failed request entered, or nothing: a cookie that is missing, not JSON or not an object refills nothing. */
export function readDraft(raw: string | undefined): AccountValues {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const draft: AccountValues = {};
    for (const key of ["firstName", "lastName", "email", "phone", "language"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string") draft[key] = value;
    }
    return draft;
  } catch {
    return {};
  }
}

/**
 * `values` fills the inputs; `failing` names the fields whose error line shows; `emailHelp` is the key of the
 * email's help line, which each form words for itself.
 */
export async function AccountFields({
  values,
  failing,
  emailHelp,
}: {
  values: AccountValues;
  failing: ReadonlySet<string>;
  emailHelp: MessageKey;
}): Promise<ReactNode> {
  const [t, language] = await Promise.all([getTranslator(), getLanguage()]);
  const fieldError = (field: AccountField) =>
    failing.has(field) ? <FieldError id={`${field}-error`}>{t(ERROR_KEYS[field])}</FieldError> : null;
  /** What an input is described by: its error line, then its help line. */
  const described = (field: AccountField, help?: string) =>
    [failing.has(field) ? `${field}-error` : null, help].filter(Boolean).join(" ") || undefined;
  const invalid = (field: AccountField) => (failing.has(field) ? true : undefined);

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-6">
        <div className="min-w-0 flex-1 basis-36">
          <Field label={t("createAccount.firstName")} htmlFor="firstName">
            <Input
              id="firstName"
              name="firstName"
              maxLength={ACCOUNT_LIMITS.firstName}
              autoComplete="given-name"
              defaultValue={values.firstName ?? ""}
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
              maxLength={ACCOUNT_LIMITS.lastName}
              autoComplete="family-name"
              defaultValue={values.lastName ?? ""}
              aria-invalid={invalid("lastName")}
              aria-describedby={described("lastName")}
            />
            {fieldError("lastName")}
          </Field>
        </div>
      </div>
      <Field label={t("signIn.emailLabel")} htmlFor="email" help={t(emailHelp)}>
        <Input
          id="email"
          name="email"
          maxLength={ACCOUNT_LIMITS.email}
          type="email"
          autoComplete="email"
          defaultValue={values.email ?? ""}
          aria-invalid={invalid("email")}
          aria-describedby={described("email", "email-help")}
        />
        {fieldError("email")}
      </Field>
      <Field label={t("createAccount.phone")} htmlFor="phone" help={t("createAccount.phoneHelp")}>
        <Input
          id="phone"
          name="phone"
          maxLength={ACCOUNT_LIMITS.phone}
          type="tel"
          autoComplete="tel"
          defaultValue={values.phone ?? ""}
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
          defaultValue={isLanguage(values.language) ? values.language : language}
        />
      </Field>
    </>
  );
}
