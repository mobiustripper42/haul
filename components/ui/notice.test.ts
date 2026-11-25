// Issue 38, AC6: Notice renders the alert the screens hand-wrote (app/sign-in/page.tsx:24-31,
// app/sign-in/code/page.tsx:24-27).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { alertTexts, attributesOf, blocksInsideParagraphs, normalMarkup, screenMarkup, utilitiesOf } from "../../app/screen-test-helpers";
import { Notice, type NoticeIcon } from "./notice";

describe("AC6 — Notice", () => {
  it.each(["lock", "clock", "alert"] as const)(
    'AC6: with icon %s renders <p role="alert" class="notice notice-<icon>"> around its children, and nothing else',
    (icon: NoticeIcon) => {
      const html = renderToStaticMarkup(createElement(Notice, { icon, children: "Try again in 5 min." }));
      expect(normalMarkup(html)).toBe(normalMarkup(`<p role="alert" class="notice notice-${icon}">Try again in 5 min.</p>`));
    },
  );
});

// Issue 145: `lead`, the bold first line the account home's and the card page's Notices open with: the one home for the
// markup account home and the cancel page wrote by hand. Its words are each screen's; here, how it is drawn.
describe("AC1 (issue 145) — Notice's lead", () => {
  const html = () => renderToStaticMarkup(createElement(Notice, { icon: "alert", lead: "Your card was declined.", children: "Update it to keep your meal." }));

  it("AC1: with a lead, the one alert reads the lead and then its children", () => {
    expect(alertTexts(html())).toEqual(["Your card was declined. Update it to keep your meal."]);
  });

  it("AC1: the lead is bold, on its own line", () => {
    const lead = /<strong\b([^>]*)>([\s\S]*?)<\/strong>/.exec(screenMarkup(html()));
    expect(lead?.[2]).toBe("Your card was declined.");
    expect(utilitiesOf(attributesOf(`<strong${lead?.[1] ?? ""}>`, "strong")[0]?.class)).toContain("block");
  });
});

// Issue 238: `action`, the one home for a button under a Notice's words: the declined and no-card Notices and the cancelled
// one pass theirs. Which button each passes is that page's test; here, where the action is drawn.
describe("AC5 (issue 238) — Notice's action", () => {
  const html = (lead?: string) =>
    screenMarkup(
      renderToStaticMarkup(createElement(Notice, { icon: "info", ...(lead === undefined ? {} : { lead }), action: createElement("a", { href: "/supper-club" }, "Go"), children: "The words." })),
    );
  /** The span the action sits in, as drawn. */
  const actionSpan = (drawn: string) => /<span\b[^>]*><a href="\/supper-club">Go<\/a><\/span>/.exec(drawn)?.[0];

  // `.notice` is a flex row: words and action that were two of its children would sit side by side, not one under the other.
  it.each([
    ["with no lead", undefined, "The words. Go"],
    ["with a lead", "The lead.", "The lead. The words. Go"],
  ])("AC5: %s, the alert is a p holding, in one element beside the icon, the words and then the action in its span", (_which, lead, text) => {
    const drawn = html(lead);
    expect(alertTexts(drawn)).toEqual([text]);
    expect(actionSpan(drawn)).toBeDefined();
    const inner = /^<p\b[^>]*\brole="alert"[^>]*>([\s\S]*)<\/p>$/.exec(drawn)?.[1] ?? "";
    expect(topLevelOf(inner)).toHaveLength(1);
    expect(blocksInsideParagraphs(drawn)).toEqual([]);
  });

  it("AC5: the action is drawn the same way with and without a lead", () => {
    expect(actionSpan(html("The lead."))).toBeDefined();
    expect(actionSpan(html("The lead."))).toBe(actionSpan(html()));
  });

  /** The text runs and elements directly inside `inner`, in order. */
  function topLevelOf(inner: string): string[] {
    const found: string[] = [];
    let depth = 0;
    for (const [piece] of inner.matchAll(/<[^>]*>|[^<]+/g)) {
      const closing = piece.startsWith("</");
      if (closing) depth -= 1;
      else {
        if (depth === 0 && piece.trim() !== "") found.push(piece);
        if (piece.startsWith("<")) depth += 1;
      }
    }
    return found;
  }
});

// Issue 101, AC3: the success notice is a kind of Notice, `check`, keeping role="alert" as every kind does.
// Its look is app/globals.css's `.notice-check`: the success-on-sage-soft pairing Badge's success kind uses,
// over the danger border, fill and icon colour `.notice` sets. The CSS is read through Tailwind's own
// compiler, as app/language-switcher-look.test.ts reads it, so a rule may @apply the utilities or name the
// tokens: each must compile to what the probes compile to.
describe("AC3 (issue 101) — Notice's check kind", () => {
  it('AC3: with icon check renders <p role="alert" class="notice notice-check"> around its children', () => {
    const html = renderToStaticMarkup(createElement(Notice, { icon: "check", children: "Sent." }));
    expect(normalMarkup(html)).toBe(normalMarkup('<p role="alert" class="notice notice-check">Sent.</p>'));
  });

  const GLOBALS = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
  const TAILWIND = fileURLToPath(new URL("../../node_modules/tailwindcss", import.meta.url));

  async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
    let path: string;
    if (id === "tailwindcss") path = join(TAILWIND, "index.css");
    else if (id.startsWith("tailwindcss/")) {
      const sub = id.slice("tailwindcss/".length);
      path = join(TAILWIND, sub.endsWith(".css") ? sub : `${sub}.css`);
    } else path = resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  }

  /** app/globals.css, with the two probes appended, compiled with no candidates. */
  async function compiled(): Promise<string> {
    const source = `${readFileSync(GLOBALS, "utf8")}\n.probe-fill { @apply bg-sage-soft; }\n.probe-icon { @apply bg-success; }\n`;
    const compiler = await compile(source, {
      base: dirname(GLOBALS),
      loadStylesheet,
      loadModule: async (id: string) => {
        throw new Error(`app/globals.css loads a module (${id}); this test resolves stylesheets only`);
      },
    });
    return compiler.build([]).replace(/\/\*[\s\S]*?\*\//g, "");
  }

  const selector = (s: string): string => s.replace(/\s+/g, " ").replace(/'/g, '"').trim();
  const declarations = (body: string): string[] =>
    body
      .split(";")
      .map((d) => d.replace(/\s+/g, " ").trim())
      .filter(Boolean);

  /** Every innermost rule whose selector is `wanted`: where it starts in the CSS, and its declarations. */
  const rulesFor = (css: string, wanted: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => selector(m[1] ?? "") === selector(wanted))
      .map((m) => ({ at: m.index ?? 0, declarations: declarations(m[2] ?? "") }));

  const declared = (css: string, wanted: string): string[] => rulesFor(css, wanted).flatMap((rule) => rule.declarations);

  it("AC3: .notice-check's fill is the sage-soft fill, and .notice-check::before's icon the success colour", async () => {
    const css = await compiled();
    const fill = declared(css, ".probe-fill");
    const icon = declared(css, ".probe-icon");
    expect(fill, "the probe .probe-fill compiled to nothing").not.toEqual([]);
    expect(icon, "the probe .probe-icon compiled to nothing").not.toEqual([]);
    expect(declared(css, ".notice-check"), "no .notice-check rule with the sage-soft fill").toEqual(expect.arrayContaining(fill));
    expect(declared(css, ".notice-check::before"), "no .notice-check::before rule with the success colour").toEqual(expect.arrayContaining(icon));
  });

  it("AC3: .notice-check sets its own border colour, and nothing in it or its icon is the danger colour", async () => {
    const css = await compiled();
    const own = [...declared(css, ".notice-check"), ...declared(css, ".notice-check::before")];
    expect(declared(css, ".notice-check").some((d) => /^border(-color)?\s*:/.test(d)), "no border colour in .notice-check").toBe(true);
    expect(own.filter((d) => d.includes("--color-danger"))).toEqual([]);
  });

  it("AC3: the overrides come after .notice's own rules, so they win over the danger look", async () => {
    const css = await compiled();
    for (const wanted of [".notice", ".notice::before", ".notice-check", ".notice-check::before"]) {
      expect(rulesFor(css, wanted), `no ${wanted} rule`).not.toEqual([]);
    }
    const last = (wanted: string) => Math.max(...rulesFor(css, wanted).map((rule) => rule.at));
    const first = (wanted: string) => Math.min(...rulesFor(css, wanted).map((rule) => rule.at));
    expect(first(".notice-check")).toBeGreaterThan(last(".notice"));
    expect(first(".notice-check::before")).toBeGreaterThan(last(".notice::before"));
  });
});
