import type { Language } from "./i18n.js";

export const ROLES = ["member", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "member";

export type Member = { id: string; email: string; language: Language; role: Role; createdAt: Date };

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
