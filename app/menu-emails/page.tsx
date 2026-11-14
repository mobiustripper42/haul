import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Heading } from "../../components/ui/heading";
import { Shell } from "../../components/ui/shell";
import { getTranslator } from "../language";
import { titled } from "../page-title";
import { MENU_PATH } from "../paths";
import { SiteHeader } from "../site-header";
import { turnMenuEmailsOff, turnMenuEmailsOn } from "./actions";
import { linkedMember } from "./linked-member";

export const generateMetadata = titled("menuEmails.title");

/**
 * Where the menu email's off link lands (issue 141, AC8): whether the member's menu emails are off or on, and the button
 * that turns them the other way. Public, and it only reads: a link whose `m` and `t` do not verify, or whose member is
 * unknown, is Next's not-found page.
 */
export default async function MenuEmails({ searchParams }: { searchParams: Promise<{ m?: string; t?: string }> }): Promise<ReactNode> {
  const { m, t: token } = await searchParams;
  const [t, member] = await Promise.all([getTranslator(), linkedMember(m ?? "", token ?? "")]);
  const on = member.menuEmails;
  return (
    <>
      {await SiteHeader({ account: "sign-in" })}
      <Shell>
        <Card>
          <Heading>{t(on ? "menuEmails.onTitle" : "menuEmails.offTitle")}</Heading>
          <p>{t(on ? "menuEmails.onBody" : "menuEmails.offBody", { email: member.email })}</p>
          <form action={on ? turnMenuEmailsOff : turnMenuEmailsOn}>
            <input type="hidden" name="m" value={member.id} />
            <input type="hidden" name="t" value={token ?? ""} />
            <Button kind="secondary" full type="submit">
              {t(on ? "menuEmails.turnOff" : "menuEmails.turnOn")}
            </Button>
          </form>
          <div className="flex">
            <Button kind="quiet" href={MENU_PATH} flush>
              {t("menuEmails.seeMenu")}
            </Button>
          </div>
        </Card>
      </Shell>
    </>
  );
}
