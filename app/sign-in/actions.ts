"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { deliverSignInCode } from "@core/sign-in-email.js";
import { EmailSendError } from "@core/ports/email.js";
import { clientIpFrom } from "@core/sign-in/client-ip.js";
import { issueSignInCode, randomCode, requestSignInCode, verifySignInCode } from "@core/sign-in/code.js";
import { limitKeyFor } from "@core/sign-in/rate-limit.js";
import { endSession, SIGN_IN_EMAIL_COOKIE, startSession } from "../session";
import { getEmail, getRepository, getSessionSecret } from "../services";

const SIGN_IN_EMAIL_MAX_AGE_SECONDS = 600;

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Asks for a code. A member's email and a stranger's get the same cookie and the same redirect. */
export async function requestCode(formData: FormData): Promise<void> {
  const email = textField(formData, "email");
  if (email === "") redirect("/sign-in");

  const repo = getRepository();
  const now = new Date();
  const result = await requestSignInCode(
    repo,
    (address) => repo.findMemberByEmail(address),
    { email, clientKey: limitKeyFor(clientIpFrom(await headers())) },
    { now, mintCode: randomCode, onLimiterFailure: (message) => console.error(message) },
  );

  if (result.outcome === "limited") {
    redirect(`/sign-in?limited=${Math.max(1, Math.ceil(result.retryAfterMs / 60_000))}`);
  }
  if (result.outcome === "issue") {
    const { pending } = result;
    // After the response, so a member's request costs what a stranger's does. Logged without the
    // error's message (Resend's carries its whole reply), the code or the message text.
    after(async () => {
      try {
        if ((await issueSignInCode(repo, pending, { now })) === "deliver") {
          await deliverSignInCode(getEmail(), pending);
        }
      } catch (error) {
        console.error("sign-in code not delivered", {
          memberId: pending.subject.id,
          error: error instanceof Error ? error.name : typeof error,
          ...(error instanceof EmailSendError ? { status: error.status } : {}),
        });
      }
    });
  }

  (await cookies()).set(SIGN_IN_EMAIL_COOKIE, email, {
    path: "/",
    maxAge: SIGN_IN_EMAIL_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/sign-in/code");
}

export async function verifyCode(formData: FormData): Promise<void> {
  const cookieStore = await cookies();
  const email = cookieStore.get(SIGN_IN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/sign-in?error=expired");
  // Read before the code is spent, so a production deploy missing its secret fails without burning one.
  getSessionSecret();

  const repo = getRepository();
  const result = await verifySignInCode(
    repo,
    (address) => repo.findMemberByEmail(address),
    { email, code: textField(formData, "code") },
    { now: new Date() },
  );
  if (!result.ok) redirect("/sign-in/code?error=invalid");

  await startSession(result.subjectId);
  cookieStore.delete(SIGN_IN_EMAIL_COOKIE);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}
