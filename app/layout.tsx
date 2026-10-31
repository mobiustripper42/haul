import type { ReactNode } from "react";
import { fontVariables } from "./fonts";
import "./globals.css";
import { getLanguage } from "./language";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLanguage()} className={fontVariables}>
      <body className="bg-surface-alt font-sans text-body text-ink">{children}</body>
    </html>
  );
}
