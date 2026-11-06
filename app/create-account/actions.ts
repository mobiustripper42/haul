"use server";

import { CREATE_ACCOUNT_PAGES } from "../paths";
import { requestAccountCodeFor, resendAccountCodeFor } from "./shared";
import { verifyCodeFor } from "../sign-in/shared";

/** The details step: checked, limited, then a code is on its way. */
export async function requestAccountCode(formData: FormData): Promise<void> {
  await requestAccountCodeFor(formData, CREATE_ACCOUNT_PAGES);
}

export async function verifyAccountCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, CREATE_ACCOUNT_PAGES);
}

/** "Send a new code": sign-in's request flow for the email in the cookie. Any `email` in the form is ignored. */
export async function resendAccountCode(formData: FormData): Promise<void> {
  await resendAccountCodeFor(formData, CREATE_ACCOUNT_PAGES);
}
