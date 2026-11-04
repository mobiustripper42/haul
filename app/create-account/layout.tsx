import type { ReactNode } from "react";
import { SiteHeader } from "../site-header";

/** Create Account opens with the same header as sign-in: no account link, since this is where one is made. */
export default async function CreateAccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {await SiteHeader({ account: "none" })}
      {children}
    </>
  );
}
