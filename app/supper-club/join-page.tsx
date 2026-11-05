// The Supper Club page's frame, and the one home for it: the header, the shell and the left column. The
// Supper Club page and its four pane pages (Create Account and sign-in, each with its code step) call it
// with their card as `children`, which stands on the right where the Join card stands. Called inline,
// `await JoinPage(...)`, as `SiteHeader` is, because `findAll` does not enter a component.
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { returnToOr } from "@core/return-to.js";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Eyebrow } from "../../components/ui/eyebrow";
import { Heading } from "../../components/ui/heading";
import { Hint } from "../../components/ui/hint";
import { Panel } from "../../components/ui/panel";
import { Shell } from "../../components/ui/shell";
import { getTranslator } from "../language";
import { SUPPER_CLUB_PATH } from "./paths";
import { RETURN_TO_COOKIE, getSignedInMember } from "../session";
import { SiteHeader } from "../site-header";

const EVERY_WEEK = [
  "supperClub.item.protein",
  "supperClub.item.grain",
  "supperClub.item.veggie",
  "supperClub.item.salad",
  "supperClub.item.soup",
] as const;

/**
 * The header by who is signed in (Sign in for a visitor, a link to the account for a member), then the
 * left column, then `children`. `pane` is which pane the page shows: "none" for the Supper Club page,
 * which keeps its left column and header link at every width; a pane hides both below `lg`, marks the
 * header's Sign in as current on the sign-in pane, and sends a signed-in member to the Supper Club page.
 */
export async function JoinPage({ pane, children }: { pane: "none" | "create-account" | "sign-in"; children: ReactNode }) {
  const [t, member] = await Promise.all([getTranslator(), getSignedInMember()]);
  if (pane !== "none" && member) redirect(SUPPER_CLUB_PATH);
  const account = member ? "your-account" : pane === "sign-in" ? "sign-in-current" : "sign-in";
  const wide = pane === "none" ? "" : " wide-only";
  return (
    <>
      {await SiteHeader({ account, wideOnly: pane !== "none" })}
      <Shell width={pane === "none" ? "page" : "pane"}>
        <section className={`flex min-w-0 flex-1 flex-col gap-5${wide}`}>
          <div className="flex flex-col gap-2">
            <Eyebrow tone="muted">{t("supperClub.eyebrow")}</Eyebrow>
            <Heading>{t("supperClub.title")}</Heading>
          </div>
          <p>{t("supperClub.intro")}</p>
          <p className="text-ink-muted">{t("supperClub.team")}</p>
          <Card width="fill">
            <p className="font-display text-section text-teal">{t("supperClub.everyWeek")}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {EVERY_WEEK.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
            <Hint>{t("supperClub.allergens")}</Hint>
          </Card>
          <Panel title={t("supperClub.sampleTitle")}>
            <p className="font-semibold text-teal">{t("supperClub.sampleMain")}</p>
            <p>{t("supperClub.sampleSides")}</p>
            <Hint>{t("supperClub.sampleVegan")}</Hint>
          </Panel>
          <p>
            <strong className="font-semibold">{t("supperClub.pickupWhen")}</strong> {t("supperClub.pickupWhere")}
          </p>
        </section>
        <section className="min-w-0 flex-1">{children}</section>
      </Shell>
    </>
  );
}

/**
 * "Back to your choices" above a pane's heading, for lg and wider: the return path in the cookie, or the
 * Supper Club page when there is none, or `/` when what is held is unsafe (`returnToOr`).
 */
export async function BackToChoices() {
  const [t, cookieStore] = await Promise.all([getTranslator(), cookies()]);
  return (
    <p className="wide-only">
      <Button kind="quiet" href={returnToOr(cookieStore.get(RETURN_TO_COOKIE)?.value, SUPPER_CLUB_PATH)} back flush>
        {t("supperClub.backToChoices")}
      </Button>
    </p>
  );
}
