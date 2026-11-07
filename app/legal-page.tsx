// The one layout the Terms and Privacy pages share (issue 63). Called inline,
// `return await LegalPage({ ... })`, as `JoinPage` is, because `react-dom/server` cannot render an async
// component written as JSX (`app/language-switcher.tsx`).
import { parseLegalDocument } from "@core/legal-documents.js";
import { BulletList } from "../components/ui/bullet-list";
import { Card } from "../components/ui/card";
import { Heading } from "../components/ui/heading";
import { Hint } from "../components/ui/hint";
import { Shell } from "../components/ui/shell";
import { getTranslator } from "./language";
import { SiteHeader } from "./site-header";

/**
 * A legal document on a page: the header with no account link, then one reading-width card holding the
 * title, "Last updated [DATE]" and the document's blocks in order. The title and the text come already
 * translated, from the page's own catalog keys.
 */
export async function LegalPage({ title, text }: { title: string; text: string }) {
  const t = await getTranslator();
  return (
    <>
      {await SiteHeader({ account: "none" })}
      <Shell>
        <Card width="reading">
          <Heading>{title}</Heading>
          <Hint>{t("legal.lastUpdated")}</Hint>
          {parseLegalDocument(text).map((block, index) => {
            if (block.kind === "heading") return <Heading key={index} level={2}>{block.text}</Heading>;
            if (block.kind === "list") return <BulletList key={index} items={block.items} />;
            return <p key={index}>{block.text}</p>;
          })}
        </Card>
      </Shell>
    </>
  );
}
