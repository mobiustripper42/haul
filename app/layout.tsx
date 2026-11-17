import type { ReactNode } from "react";
import { fontVariables } from "./fonts";
import "./globals.css";
import { getLanguage } from "./language";
import { SiteFooter } from "./site-footer";

// Every page reads the database or the session, so every page renders per request, never at build time.
// Stated here because, until issue 187, `getLanguage()` reading the lang cookie made every page per-request
// by accident; with no cookie read, `next build` prerendered pages and failed reaching for the database.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLanguage()} className={fontVariables}>
      <body className="flex min-h-dvh flex-col bg-surface-alt font-sans text-body text-ink">
        {children}
        {await SiteFooter()}
      </body>
    </html>
  );
}
