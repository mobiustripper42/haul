"use server";

// The menu emails page's two buttons (issue 141, AC8). Each verifies the `m` and `t` its form posts again before it
// writes, as the page did before it drew the form, and lands back on the page for the member.
import { redirect } from "next/navigation";
import { menuEmailsPath } from "../paths";
import { getRepository } from "../services";
import { textField } from "../sign-in/shared";
import { linkedMember } from "./linked-member";

/** Sets the member's preference and goes back to the page. */
async function setPreference(formData: FormData, on: boolean): Promise<never> {
  const memberId = textField(formData, "m");
  const token = textField(formData, "t");
  const member = await linkedMember(memberId, token);
  await getRepository().withActor({ member: member.id }, (scoped) => scoped.setMenuEmails(member.id, on));
  redirect(menuEmailsPath(memberId, token));
}

/** "Turn menu emails back on". */
export async function turnMenuEmailsOn(formData: FormData): Promise<void> {
  await setPreference(formData, true);
}

/** "Turn them off". */
export async function turnMenuEmailsOff(formData: FormData): Promise<void> {
  await setPreference(formData, false);
}
