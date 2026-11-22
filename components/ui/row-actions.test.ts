// Issue 220, AC6: RowActions, a list row's actions — the main action alone, beside one other, or with two or more
// others under More, a `<details>` whose summary shows `moreLabel` and is named `moreName` for a screen reader. Which
// actions a row passes is its page's (app/admin/weeks/page.test.ts); how More looks, floats and closes is by hand.
//
// A form action is given React's server-reference hook, `$$FORM_ACTION`, which is how a server action renders
// (Next's own references carry it): React writes the id it returns as a hidden `$ACTION_ID_<id>` field in the form,
// so the markup says which action a form posts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup } from "../../app/screen-test-helpers";
import { RowActions, type RowAction } from "./row-actions";

const MORE_LABEL = "Overflow";
const MORE_NAME = "Overflow for the probe row";

/** A server action whose form renders `$ACTION_ID_<id>`. */
const probeAction = (id: string): ((data: FormData) => Promise<void>) =>
  Object.assign(async (data: FormData) => void data, {
    $$FORM_ACTION: () => ({ name: `$ACTION_ID_${id}`, action: "", encType: "multipart/form-data", method: "POST", data: null }),
  });

const MAIN: RowAction = { label: "Main thing", href: "/rows?main=1" };
const FIRST: RowAction = { label: "First other", href: "/rows?first=1" };
const SECOND: RowAction = { label: "Second other", href: "/rows?second=1" };
const FORM: RowAction = { label: "Form other", action: probeAction("form-other"), fields: { row: "r-7", flag: "1" } };

const render = (main: RowAction | undefined, others: RowAction[]): string =>
  screenMarkup(renderToStaticMarkup(createElement(RowActions, { main, others, moreLabel: MORE_LABEL, moreName: MORE_NAME })));

const textOf = (inner: string): string => inner.replace(/<[^>]*>/g, "").trim();

/** Every link and button in `html`, in document order: a link as its text and href, a button as its text. */
const controlsOf = (html: string): Array<{ label: string; href?: string }> =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>|<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(([whole, attrs = "", linkInner = "", buttonInner = ""]) =>
    whole.startsWith("<a")
      ? { label: textOf(linkInner), href: /\bhref="([^"]*)"/.exec(attrs)?.[1] ?? "" }
      : { label: textOf(buttonInner) },
  );

/** How `action` is drawn as a control: a link with its href, a form's button with its label. */
const drawn = (action: RowAction): { label: string; href?: string } => ("href" in action ? { label: action.label, href: action.href } : { label: action.label });

/** The `<details>` elements: each one's summary markup and its panel, the markup after the summary. */
const detailsOf = (html: string): Array<{ summary: string; panel: string }> =>
  [...html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)].map(([, inner = ""]) => ({
    summary: /<summary\b[\s\S]*?<\/summary>/.exec(inner)?.[0] ?? "",
    panel: inner.split("</summary>")[1] ?? "",
  }));

/** The markup outside every `<details>`. */
const outsideDetails = (html: string): string => html.replace(/<details\b[\s\S]*?<\/details>/g, "");

/** The form whose button reads `label`, as markup. */
const formOf = (html: string, label: string): string =>
  [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([form]) => form).find((form) => controlsOf(form).some((control) => control.label === label)) ?? "";

describe("AC6 (issue 220) — RowActions draws by how many others there are", () => {
  it("AC6: a main action and no others: the main action alone, and no More", () => {
    const html = render(MAIN, []);
    expect(controlsOf(html)).toEqual([drawn(MAIN)]);
    expect(detailsOf(html)).toEqual([]);
  });

  it("AC6: one other: the main action, then the other, both as buttons, and no More", () => {
    const html = render(MAIN, [FIRST]);
    expect(controlsOf(html)).toEqual([drawn(MAIN), drawn(FIRST)]);
    expect(detailsOf(html)).toEqual([]);
  });

  it("AC6: two others: the main action outside a <details>, which holds the two", () => {
    const html = render(MAIN, [FIRST, SECOND]);
    const details = detailsOf(html);
    expect(details).toHaveLength(1);
    expect(controlsOf(outsideDetails(html))).toEqual([drawn(MAIN)]);
    expect(controlsOf(details[0]?.panel ?? "")).toEqual([drawn(FIRST), drawn(SECOND)]);
  });

  it("AC6: the <details>'s summary shows moreLabel, and its screen-reader name is moreName", () => {
    const [details] = detailsOf(render(MAIN, [FIRST, SECOND]));
    const summary = details?.summary ?? "";
    expect(textOf(summary)).toBe(MORE_LABEL);
    expect(attributesOf(summary, "summary")[0]?.["aria-label"]).toBe(MORE_NAME);
  });

  it("AC6: three others, a form among them, are held in the order given", () => {
    const html = render(MAIN, [FIRST, FORM, SECOND]);
    const [details] = detailsOf(html);
    expect(controlsOf(details?.panel ?? "")).toEqual([drawn(FIRST), drawn(FORM), drawn(SECOND)]);
    expect(controlsOf(outsideDetails(html))).toEqual([drawn(MAIN)]);
  });

  it("AC6: a form action under More posts its action with its fields", () => {
    const [details] = detailsOf(render(MAIN, [FIRST, FORM]));
    const form = formOf(details?.panel ?? "", FORM.label);
    expect(form).toContain("$ACTION_ID_form-other");
    const fields = attributesOf(form, "input").filter((input) => input.type === "hidden" && !input.name?.startsWith("$ACTION_"));
    expect(Object.fromEntries(fields.map((input) => [input.name, input.value]))).toEqual({ row: "r-7", flag: "1" });
  });
});

// Issue 231, AC2: a row may have no main action — a closed week past its cutoff has no action at all — and RowActions
// owns both cases, so the calendar passes what it has (app/admin/weeks/page.test.ts). With others only, the row is drawn
// exactly as if the first other were its main action.
describe("AC2 (issue 231) — RowActions with no main action", () => {
  it("AC2 (issue 231): no main and no others: nothing is drawn", () => {
    expect(render(undefined, [])).toBe("");
  });

  it("AC2 (issue 231): no main and one other: drawn as that other alone, as a main action", () => {
    expect(render(undefined, [FIRST])).toBe(render(FIRST, []));
  });

  it("AC2 (issue 231): no main and three others: the first drawn as main, the other two under More", () => {
    expect(render(undefined, [FIRST, SECOND, FORM])).toBe(render(FIRST, [SECOND, FORM]));
  });
});
