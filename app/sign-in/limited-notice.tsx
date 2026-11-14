import type { ReactNode } from "react";
import type { Language } from "@core/i18n.js";
import { Notice } from "../../components/ui/notice";
import { limitedText } from "./shared";

/**
 * Sign-in's wait notice, the one home for it (issue 156): the lock and the request limit's words for `minutes`.
 * Called inline, as `CodeStep` is, because `findAll` does not enter a component.
 */
export function limitedNotice(language: Language, minutes: number): ReactNode {
  return <Notice icon="lock">{limitedText(language, minutes)}</Notice>;
}
