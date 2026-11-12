// Issue 140, AC4 and AC5: the menu form, `MenuForm` rendered through react-dom/server with a state and a stand-in
// for the words the page translates, as app/admin/members-list.test.ts renders MembersList. The state is what
// `useActionState` starts from, so a render with errors set is the form after a failed save. Which options the
// page gives it, in which words, is the pages' (./new/page.test.ts, ./[menu]/page.test.ts); what a save checks is
// checkMenu's (src/menus.test.ts) and what the actions return is ./actions.test.ts's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributesOf, screenMarkup, textsOf } from "../../screen-test-helpers";
import { MenuForm, type MenuFormText } from "./menu-form";
import { MENU_NAME_FIELD, menuTextField, type MenuFormState } from "./shared";

const TEXT: MenuFormText = {
  name: "Title",
  nameHelp: "What members see",
  textLabel: "{option} words",
  textHelp: "A dish a line",
  save: "Keep it",
  errors: { nameRequired: "Name it", nameTooLong: "Shorter name", textRequired: "Fill in {option}", textTooLong: "Shorten {option}" },
};

const OPTIONS = [
  { id: "option-standard", name: "Standard" },
  { id: "option-vegan", name: "Vegan" },
];

const state = (over: Partial<MenuFormState> = {}): MenuFormState => ({ name: "", texts: {}, errors: null, ...over });

const action = async (previous: MenuFormState): Promise<MenuFormState> => previous;

const render = (formState: MenuFormState, assigned?: { line: string; help: string }) =>
  renderToStaticMarkup(createElement(MenuForm, { action, state: formState, options: OPTIONS, text: TEXT, ...(assigned ? { assigned } : {}) }));

/** Each textarea: its name and its text. */
const textareas = (html: string): { name: string; value: string }[] =>
  [...screenMarkup(html).matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map(([, attrs = "", inner = ""]) => ({
    name: /\bname="([^"]*)"/.exec(attrs)?.[1] ?? "",
    value: inner,
  }));

/** Of `wanted`, the texts the form shows, in the order it shows them. */
const inSequence = (html: string, wanted: readonly string[]): string[] => textsOf(html).filter((text) => wanted.includes(text));

describe("AC4 — the fields", () => {
  it("AC4: the name, then a field per menu option in the order given, labelled with the option, then Save", () => {
    const html = render(state());
    const wanted = [TEXT.name, TEXT.nameHelp, "Standard words", "Vegan words", TEXT.save];
    expect(inSequence(html, wanted)).toEqual(wanted);
  });

  it("AC4: the name posts as MENU_NAME_FIELD and each text as menuTextField of its option, in option order", () => {
    const html = render(state());
    expect(attributesOf(html, "input").map((input) => input.name)).toContain(MENU_NAME_FIELD);
    expect(textareas(html).map((area) => area.name)).toEqual(OPTIONS.map((option) => menuTextField(option.id)));
  });

  it("AC4: the fields hold what the state holds, as typed", () => {
    const html = render(state({ name: "  Autumn harvest ", texts: { "option-standard": "Squash soup  \n\nRye bread", "option-vegan": "Lentil soup" } }));
    expect(attributesOf(html, "input").find((input) => input.name === MENU_NAME_FIELD)?.value).toBe("  Autumn harvest ");
    expect(textareas(html).map((area) => area.value)).toEqual(["Squash soup  \n\nRye bread", "Lentil soup"]);
  });

  it("AC4: with no errors in the state, no error shows", () => {
    const texts = textsOf(render(state({ errors: null })));
    for (const error of [TEXT.errors.nameRequired, TEXT.errors.nameTooLong, "Fill in Standard", "Fill in Vegan", "Shorten Standard", "Shorten Vegan"]) {
      expect(texts).not.toContain(error);
    }
  });
});

describe("AC4 — a failed save", () => {
  it("AC4: each error shows under its own field, a text's naming its option, with everything typed kept", () => {
    const typed = { "option-standard": "Squash soup", "option-vegan": "" };
    const html = render(state({ name: "", texts: typed, errors: { name: "required", texts: { "option-vegan": "required" } } }));
    const wanted = [TEXT.name, TEXT.errors.nameRequired, "Standard words", "Vegan words", "Fill in Vegan", TEXT.save];
    expect(inSequence(html, wanted)).toEqual(wanted);
    expect(textsOf(html)).not.toContain("Fill in Standard");
    expect(textareas(html).map((area) => area.value)).toEqual(["Squash soup", ""]);
  });

  it("AC4: a name and a text too long show their too-long errors", () => {
    const html = render(state({ name: "a".repeat(101), errors: { name: "tooLong", texts: { "option-standard": "tooLong" } } }));
    const wanted = [TEXT.name, TEXT.errors.nameTooLong, "Standard words", "Shorten Standard", "Vegan words"];
    expect(inSequence(html, wanted)).toEqual(wanted);
    expect(textsOf(html)).not.toContain(TEXT.errors.nameRequired);
  });
});

describe("AC5 — the editor's Assigned line", () => {
  it("AC5: given one, the Assigned line and its help sit after the fields and before Save", () => {
    const html = render(state(), { line: "On two weeks", help: "Assign under Weeks" });
    const wanted = ["Vegan words", "On two weeks", "Assign under Weeks", TEXT.save];
    expect(inSequence(html, wanted)).toEqual(wanted);
  });

  it("AC5: New menu, given none, shows neither", () => {
    const texts = textsOf(render(state()));
    expect(texts).not.toContain("On two weeks");
    expect(texts).not.toContain("Assign under Weeks");
  });
});
