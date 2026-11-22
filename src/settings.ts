import type { Repository } from "./ports/repository.js";

/**
 * The `settings` table's one read (issue 231, DEC-049): a row's value as a whole number. No row is the fallback,
 * silently. A whole number, surrounding spaces allowed, is that number. Anything else is the fallback and one log line
 * naming the key: a typo in a hand-written SQL row must not break a run, and must not be silent, since the operator
 * believes the setting is in force. The parse is muster's (`src/config/whole-number-setting.ts`).
 */

export const MISSING_MENU_DAYS_KEY = "missing_menu_days";
export const MISSING_NOTE_DAYS_KEY = "missing_note_days";

/** The days each reminder looks ahead when its row is absent or malformed; the Supper Club seed writes the same values. */
export const MISSING_MENU_DAYS_DEFAULT = 14;
export const MISSING_NOTE_DAYS_DEFAULT = 3;

export async function wholeNumberSetting(repo: Repository, key: string, fallback: number): Promise<number> {
  const raw = await repo.readSetting(key);
  if (raw === null) return fallback;
  if (/^\s*\d+\s*$/.test(raw)) return Number(raw.trim());
  console.error("setting is not a whole number, using the fallback", { key, fallback });
  return fallback;
}
