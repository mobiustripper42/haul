import type { Translator } from "@core/i18n.js";
import { Notice } from "../../components/ui/notice";

/**
 * The Notice a request refused past its week's cutoff sends the member back with (issues 137, 138 and 219): the one home
 * of the `account.weeks.cutoffPassed` line, drawn by account home for a refused Switch and by Upcoming weeks for a
 * refused Skip or Unskip.
 */
export function CutoffNotice({ t }: { t: Translator }) {
  return <Notice icon="alert">{t("account.weeks.cutoffPassed")}</Notice>;
}
