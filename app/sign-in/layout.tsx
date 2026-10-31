import type { ReactNode } from "react";
import { getTranslator } from "../language";
import { LanguageSwitcher } from "../language-switcher";

/** The header both sign-in screens open with: the farm's name, then the language switch. */
export default async function SignInLayout({ children }: { children: ReactNode }) {
  const t = await getTranslator();
  return (
    <>
      <header className="border-b border-divider bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3">
          <a href="/" className="flex flex-col">
            <span className="font-display text-wordmark text-teal uppercase">{t("brand.name")}</span>
            <span className="text-label font-normal tracking-normal text-ink-muted">{t("brand.byline")}</span>
          </a>
          {await LanguageSwitcher()}
        </div>
      </header>
      {children}
    </>
  );
}
