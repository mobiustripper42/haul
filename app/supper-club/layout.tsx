import type { ReactNode } from "react";
import { getSignedInMember } from "../session";
import { SiteHeader } from "../site-header";

/** The Supper Club page's header links to sign-in for a visitor and to the account for a member. */
export default async function SupperClubLayout({ children }: { children: ReactNode }) {
  const member = await getSignedInMember();
  return (
    <>
      {await SiteHeader({ account: member ? "your-account" : "sign-in" })}
      {children}
    </>
  );
}
