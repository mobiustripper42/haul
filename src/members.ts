import type { Language } from "./i18n.js";

export const ROLES = ["member", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "member";

/**
 * `firstName`, `lastName` and `phone` are null for a member who never went through Create Account.
 * `emailConfirmedAt` is null until a sign-in code or link is first redeemed (DEC-029). `squareCustomerId`
 * is null until the member's first payment (issue 56).
 */
export type Member = {
  id: string;
  email: string;
  language: Language;
  role: Role;
  createdAt: Date;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  emailConfirmedAt: Date | null;
  squareCustomerId: string | null;
};

/** The member's name as a person reads it, "First Last", whichever is stored; `null` with neither. */
export function memberDisplayName(member: Pick<Member, "firstName" | "lastName">): string | null {
  const name = [member.firstName, member.lastName].filter((part) => part !== null && part !== "").join(" ");
  return name === "" ? null : name;
}

/** Emails are stored and looked up normalized, so one plain unique constraint is case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`A member with the email ${email} already exists`);
    this.name = "DuplicateEmailError";
  }
}
