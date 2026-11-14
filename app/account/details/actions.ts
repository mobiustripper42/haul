"use server";

// Your details' four actions (issue 156). Each acts on the member `requireSubscriber` gives, never on an id the form
// posts. The code rules are `requestEmailChange`'s and `verifyEmailChange`'s; what lives here is what is stored, what
// is emailed after the response and to whom, what is recorded, what is counted in sign-in's request limit, and where
// the member lands.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateAccountDetails } from "@core/create-account.js";
import { requestEmailChange, verifyEmailChange } from "@core/email-change.js";
import { normalizeEmail } from "@core/members.js";
import { recordEventAs } from "@core/record-event.js";
import { randomCode } from "@core/sign-in/code.js";
import { deliverEmailChangeCode, deliverEmailChangedNotice } from "@core/sign-in-email.js";
import { entered, keepDraft } from "../../create-account/shared";
import { ACCOUNT_DETAILS_PATH } from "../../paths";
import { getEmail, getPayments, getRepository, getSiteUrl } from "../../services";
import { ACCOUNT_DRAFT_COOKIE } from "../../session";
import { sendAfterResponse, takeRequestLimit, textField } from "../../sign-in/shared";
import { requireSubscriber } from "../subscriber";

/**
 * Saves the form. Name, phone and language are stored at once, with the email changed or not (AC8); an email that
 * differs from the member's, past case and spaces, then starts a change in sign-in's request limit, and the code goes
 * to the new address after the response. A rule broken stores nothing and refills the form.
 */
export async function saveDetails(formData: FormData): Promise<void> {
  const { member } = await requireSubscriber();
  const draft = {
    firstName: entered(formData, "firstName"),
    lastName: entered(formData, "lastName"),
    email: entered(formData, "email"),
    phone: entered(formData, "phone"),
    language: entered(formData, "language"),
  };
  const checked = validateAccountDetails(draft);
  if (!checked.ok) {
    await keepDraft(draft);
    redirect(`${ACCOUNT_DETAILS_PATH}?error=${checked.errors.join(",")}`);
  }
  (await cookies()).delete(ACCOUNT_DRAFT_COOKIE);

  // Read before anything is stored or counted, so a misconfigured production fails the same way for every save.
  const siteUrl = getSiteUrl();
  const repo = getRepository();
  const { details } = checked;
  const saved = await repo.withActor({ member: member.id }, (scoped) =>
    scoped.saveMemberDetails(member.id, {
      firstName: details.firstName,
      lastName: details.lastName,
      phone: details.phone,
      language: details.language,
    }),
  );
  if (normalizeEmail(details.email) === member.email) redirect(`${ACCOUNT_DETAILS_PATH}?saved=1`);

  const now = new Date();
  const minutes = await takeRequestLimit(repo, now);
  if (minutes !== null) redirect(`${ACCOUNT_DETAILS_PATH}?limited=${minutes}`);

  const code = randomCode();
  const change = await requestEmailChange(repo, saved, details.email, { now, mintCode: () => code });
  if (change.send === "code") {
    sendAfterResponse(
      member.id,
      async () => undefined,
      async () => {
        await deliverEmailChangeCode(getEmail(), { member: saved, newEmail: normalizeEmail(details.email), code: change.code }, siteUrl);
      },
      "email change code not delivered",
    );
  }
  redirect(ACCOUNT_DETAILS_PATH);
}

/**
 * The code on the step. Right, the new address is the member's email, Square's customer first (AC11), and the change
 * is recorded as the member's own act. One failure for every reason but Square's. No sign-in code is touched, so
 * wrong guesses here lock nothing and email no link.
 */
export async function confirmEmailChange(formData: FormData): Promise<void> {
  const { member } = await requireSubscriber();
  const siteUrl = getSiteUrl();
  const repo = getRepository();
  const payments = getPayments();
  const now = new Date();
  // Only the write is the member's own act: the claim, the checks and Square's call run outside any transaction.
  const result = await verifyEmailChange(repo, payments, member, textField(formData, "code"), {
    now,
    scope: (run) => repo.withActor({ member: member.id }, run),
  });
  if (!result.ok) redirect(`${ACCOUNT_DETAILS_PATH}?error=${result.reason}`);

  await recordEventAs(repo, { member: member.id }, { kind: "email_changed", memberId: member.id, detail: { from: result.from, to: result.to } });
  // To the old address, in the member's email language; a failure to send is logged and the change stands.
  sendAfterResponse(
    member.id,
    async () => undefined,
    async () => {
      await deliverEmailChangedNotice(getEmail(), { member, oldEmail: result.from, newEmail: result.to }, siteUrl);
    },
    "email changed notice not delivered",
  );
  redirect(`${ACCOUNT_DETAILS_PATH}?saved=1`);
}

/** "Send a new code": a new code for the address already pending, counted in sign-in's request limit. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a form action's signature: this one reads nothing the form posts
export async function resendEmailChange(_formData: FormData): Promise<void> {
  const { member } = await requireSubscriber();
  const siteUrl = getSiteUrl();
  const repo = getRepository();
  const pending = await repo.findEmailChange(member.id);
  if (!pending) redirect(ACCOUNT_DETAILS_PATH);

  const now = new Date();
  const minutes = await takeRequestLimit(repo, now);
  if (minutes !== null) redirect(`${ACCOUNT_DETAILS_PATH}?limited=${minutes}`);

  const code = randomCode();
  const change = await requestEmailChange(repo, member, pending.newEmail, { now, mintCode: () => code });
  if (change.send === "code") {
    sendAfterResponse(
      member.id,
      async () => undefined,
      async () => {
        await deliverEmailChangeCode(getEmail(), { member, newEmail: pending.newEmail, code: change.code }, siteUrl);
      },
      "email change code not delivered",
    );
  }
  redirect(`${ACCOUNT_DETAILS_PATH}?sent=1`);
}

/** "Keep the old email": drops the pending change, so its code no longer works. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a form action's signature: this one reads nothing the form posts
export async function keepOldEmail(_formData: FormData): Promise<void> {
  const { member } = await requireSubscriber();
  await getRepository().dropEmailChange(member.id);
  redirect(ACCOUNT_DETAILS_PATH);
}
