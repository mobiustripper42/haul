import type { ReactNode } from "react";
import { fontVariables } from "./fonts";
import "./globals.css";
import { getLanguage } from "./language";
import { SiteFooter } from "./site-footer";

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
