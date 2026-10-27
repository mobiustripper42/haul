import type { Language } from "./i18n.js";

export type Member = { id: string; email: string; language: Language; createdAt: Date };

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
