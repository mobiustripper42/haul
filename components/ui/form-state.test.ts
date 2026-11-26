// Issue 235: "has this form changed" is the form's whole state against the state the server sent, compared as
// `canonicalFormState`'s strings. The comparison's edge cases are owned here; what a form's Save does with the answer, one
// change and one put-back per kind of control, is e2e/form-changes.spec.ts's. `formState` reads a live form, which Vitest
// (environment "node", no DOM) has none of, so it is the e2e spec's too.
import { describe, expect, it } from "vitest";
import { canonicalFormState } from "./form-state";

type Pairs = [string, string][];

/** Your details as the server sends it: a member's values, and the Menu emails box ticked. */
const SENT: Pairs = [
  ["firstName", "Ada"],
  ["lastName", "Lovelace"],
  ["email", "ada@example.com"],
  ["phone", "(216) 555-0134"],
  ["language", "en"],
  ["menuEmails", "on"],
];

const changed = (pairs: Pairs): boolean => canonicalFormState(pairs) !== canonicalFormState(SENT);

describe("AC7 (issue 235) — any change is a changed form", () => {
  it("AC7: a field holding another value is a changed form", () => {
    expect(changed(SENT.map(([name, value]) => [name, name === "firstName" ? "Ava" : value]))).toBe(true);
  });

  it("AC7: a box unticked, which posts nothing, is a changed form", () => {
    expect(changed(SENT.filter(([name]) => name !== "menuEmails"))).toBe(true);
  });

  it("AC7: a box ticked, which adds an entry, is a changed form", () => {
    const unticked = SENT.filter(([name]) => name !== "menuEmails");
    expect(canonicalFormState([...unticked, ["menuEmails", "on"]])).not.toBe(canonicalFormState(unticked));
  });

  it("AC7: a name sent twice is not the same form as the name sent once", () => {
    expect(canonicalFormState([["day", "1"]])).not.toBe(
      canonicalFormState([
        ["day", "1"],
        ["day", "1"],
      ]),
    );
  });

  it("AC7: a value that runs across where one field ends and the next begins is a changed form", () => {
    expect(canonicalFormState([["ab", "c"]])).not.toBe(canonicalFormState([["a", "bc"]]));
    expect(
      canonicalFormState([
        ["firstName", "Ada L"],
        ["lastName", "ovelace"],
      ]),
    ).not.toBe(
      canonicalFormState([
        ["firstName", "Ada"],
        ["lastName", " Lovelace"],
      ]),
    );
  });
});

describe("AC8 (issue 235) — a form put back is an unchanged form", () => {
  it("AC8: the same fields holding the same values are the same form", () => {
    expect(changed(SENT.map(([name, value]) => [name, value]))).toBe(false);
  });

  it("AC8: a character typed then deleted leaves the same form", () => {
    const typed = SENT.map(([name, value]): [string, string] => [name, name === "firstName" ? `${value}x` : value]);
    expect(changed(typed)).toBe(true);
    expect(changed(typed.map(([name, value]) => [name, name === "firstName" ? value.slice(0, -1) : value]))).toBe(false);
  });

  it("AC8: the same fields read in another order are the same form", () => {
    expect(changed([...SENT].reverse())).toBe(false);
  });

  it("AC8: a name sent twice, its values read in another order, is the same form", () => {
    expect(
      canonicalFormState([
        ["day", "1"],
        ["day", "2"],
      ]),
    ).toBe(
      canonicalFormState([
        ["day", "2"],
        ["day", "1"],
      ]),
    );
  });

  it("AC8: a box unticked then ticked again leaves the same form", () => {
    const unticked = SENT.filter(([name]) => name !== "menuEmails");
    expect(changed([...unticked, ["menuEmails", "on"]])).toBe(false);
  });
});
