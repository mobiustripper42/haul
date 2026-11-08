import type { Metadata } from "next";
import type { MessageKey } from "@core/i18n.js";
import { getTranslator } from "./language";

/**
 * A page's `generateMetadata`: its title is the screen's heading, `key`, followed by " · " and the brand, in
 * the request's language (issue 101, AC1).
 */
export function titled(key: MessageKey): () => Promise<Metadata> {
  return async () => {
    const t = await getTranslator();
    return { title: `${t(key)} · ${t("brand.name")}` };
  };
}
