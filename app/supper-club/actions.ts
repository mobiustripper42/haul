"use server";

// The pane's server actions: each is the action it mirrors, with a fixed page set from paths.ts so every
// failure and every redirect stays in the pane. The page set never comes from a form value.
import { requestAccountCodeFor, resendAccountCodeFor } from "../create-account/shared";
import { requestCodeFor, verifyCodeFor } from "../sign-in/shared";
import { PANE_CREATE_PAGES, PANE_SIGN_IN_PAGES } from "./paths";

export async function requestPaneCode(formData: FormData): Promise<void> {
  await requestCodeFor(formData, PANE_SIGN_IN_PAGES);
}

export async function verifyPaneCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, PANE_SIGN_IN_PAGES);
}

export async function requestPaneAccountCode(formData: FormData): Promise<void> {
  await requestAccountCodeFor(formData, PANE_CREATE_PAGES);
}

export async function verifyPaneAccountCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, PANE_CREATE_PAGES);
}

export async function resendPaneAccountCode(formData: FormData): Promise<void> {
  await resendAccountCodeFor(formData, PANE_CREATE_PAGES);
}
