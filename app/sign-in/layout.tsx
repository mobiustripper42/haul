import type { ReactNode } from "react";
import { SiteHeader } from "../site-header";

/** The header both sign-in screens open with: the farm's name, then the language switch. */
export default async function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {await SiteHeader({ account: "none" })}
      {children}
    </>
  );
}
