import type { ReactNode } from "react";
import { getLanguage } from "./language";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLanguage()}>
      <body>{children}</body>
    </html>
  );
}
