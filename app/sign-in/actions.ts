"use server";

import { redirect } from "next/navigation";
import { recordEventAs } from "@core/record-event.js";
import { redeemSignInLink } from "@core/sign-in/code.js";
import { endSession } from "../session";
import { getRepository, getSessionSecret } from "../services";
import { finishSignIn, requestCodeFor, SIGN_IN_PAGES, textField, verifyCodeFor } from "./shared";

/** Asks for a code. A member's email and a stranger's get the same cookie and the same redirect. */
export async function requestCode(formData: FormData): Promise<void> {
  await requestCodeFor(formData, SIGN_IN_PAGES);
}

export async function verifyCode(formData: FormData): Promise<void> {
  await verifyCodeFor(formData, SIGN_IN_PAGES);
}

/** The one button on the emailed link's page: redeems the token and signs the member in. */
export async function signInWithLink(formData: FormData): Promise<void> {
  getSessionSecret();

  const repo = getRepository();
  const result = await repo.withActor(null, (scoped) =>
    redeemSignInLink(scoped, textField(formData, "token"), { now: new Date() }),
  );
  if (!result.ok) redirect("/sign-in?error=link");

  await recordEventAs(repo, { member: result.subjectId }, { kind: "sign_in_by_link", memberId: result.subjectId });
  await finishSignIn(result.subjectId, "/");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}
