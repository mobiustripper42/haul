import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { CODE_TTL_MS } from "@core/sign-in/code.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Heading } from "../../../components/ui/heading";
import { Notice } from "../../../components/ui/notice";
import { Shell } from "../../../components/ui/shell";
import { AccountFields, readDraft } from "../../account-fields";
import { getLanguage, getTranslator } from "../../language";
import { titled } from "../../page-title";
import { getRepository } from "../../services";
import { ACCOUNT_DRAFT_COOKIE } from "../../session";
import { SiteHeader } from "../../site-header";
import { CodeStep } from "../../sign-in/code-step";
import { limitedNotice } from "../../sign-in/limited-notice";
import { limitedMinutes } from "../../sign-in/shared";
import { ACCOUNT_DETAILS_PATH } from "../../paths";
import { requireSubscriber } from "../subscriber";
import { confirmEmailChange, keepOldEmail, resendEmailChange, saveDetails } from "./actions";

export const generateMetadata = titled("account.details");

/**
 * A member's Your details (issue 156): the form, or, while an email change is pending and unexpired, the code step at
 * the same address. Everything is in the page's language (`getTranslator()`), never the member's email language.
 */
export default async function YourDetails({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; sent?: string; limited?: string }>;
}): Promise<ReactNode> {
  const { member } = await requireSubscriber();
  const { saved, error, sent, limited } = await searchParams;
  const [t, language, cookieStore, pending] = await Promise.all([
    getTranslator(),
    getLanguage(),
    cookies(),
    getRepository().findEmailChange(member.id),
  ]);
  const minutes = limitedMinutes(limited);
  const wait = minutes === null ? null : limitedNotice(language, minutes);
  const codeStep = pending !== null && pending.expiresAt.getTime() > Date.now();

  return (
    <>
      {await SiteHeader({ account: "none", current: "details" })}
      <Shell>
        <div className="flex w-full max-w-page flex-col gap-5">
          {codeStep ? (
            <Card width="fill">
              {await CodeStep({
                heading: t("details.codeTitle"),
                sentence: t("details.codeSent", { email: pending.newEmail, minutes: CODE_TTL_MS / 60_000 }),
                buttonLabel: t("createAccount.confirm"),
                verify: confirmEmailChange,
                resend: resendEmailChange,
                backHref: ACCOUNT_DETAILS_PATH,
                back: (
                  <form action={keepOldEmail}>
                    <Button kind="quiet" type="submit" back flush>
                      {t("details.keepOldEmail")}
                    </Button>
                  </form>
                ),
                invalid: error === "invalid",
                invalidText: t("details.invalidCode"),
                notice: (
                  <>
                    {error === "square" && <Notice icon="alert">{t("details.squareFailed")}</Notice>}
                    {wait}
                  </>
                ),
                sent: sent === "1",
                hint: t("createAccount.spam"),
              })}
            </Card>
          ) : (
            await form()
          )}
        </div>
      </Shell>
    </>
  );

  async function form() {
    // The form refills only after a save that broke a rule: `error` names its fields.
    const failing = new Set(error === undefined || error === "invalid" || error === "square" ? [] : error.split(","));
    const stored = { firstName: member.firstName ?? "", lastName: member.lastName ?? "", email: member.email, phone: member.phone ?? "", language: member.language };
    // The draft cookie can have expired by the time the page loads; the member's stored values stand in for it.
    const draft = failing.size > 0 ? readDraft(cookieStore.get(ACCOUNT_DRAFT_COOKIE)?.value) : {};
    const values = Object.keys(draft).length > 0 ? draft : stored;
    return (
      <>
        <Heading>{t("account.details")}</Heading>
        {saved === "1" && <Notice icon="check">{t("details.saved")}</Notice>}
        {wait}
        <Card width="fill">
          <form action={saveDetails} noValidate className="flex flex-col gap-6">
            {await AccountFields({ values, failing, emailHelp: "details.emailHelp" })}
            <Button kind="primary" full type="submit">
              {t("details.save")}
            </Button>
          </form>
        </Card>
      </>
    );
  }
}
