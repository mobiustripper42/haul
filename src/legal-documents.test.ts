// Issue 63: parseLegalDocument and the two paths, and where the two catalog texts live. No test reads
// docs/sources/ (issue 187): the legal text is the catalog's, and a change to it is a catalog edit alone.
// How the blocks look is app/legal-page.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type LegalBlock, PRIVACY_PATH, TERMS_PATH, parseLegalDocument } from "./legal-documents.js";
import { en } from "./messages/en.js";

const heading = (text: string): LegalBlock => ({ kind: "heading", text });
const paragraph = (text: string): LegalBlock => ({ kind: "paragraph", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });

describe("AC1 — parseLegalDocument", () => {
  it('AC1: a line starting "## " is a heading, without its marker', () => {
    expect(parseLegalDocument("## Your account")).toEqual([heading("Your account")]);
  });

  it('AC1: a line starting "- " is a bullet, without its marker', () => {
    expect(parseLegalDocument("- Spots are limited.")).toEqual([list("Spots are limited.")]);
  });

  it("AC1: any other line is a paragraph, as it stands", () => {
    expect(parseLegalDocument("The portal is for adults.")).toEqual([paragraph("The portal is for adults.")]);
  });

  it('AC1: a line that only nearly has a marker is a paragraph: "### Three", "#Tight", "-Tight"', () => {
    expect(parseLegalDocument("### Three\n\n#Tight\n\n-Tight")).toEqual([paragraph("### Three"), paragraph("#Tight"), paragraph("-Tight")]);
  });

  it("AC1: consecutive bullets are one list", () => {
    expect(parseLegalDocument("- One\n- Two\n- Three")).toEqual([list("One", "Two", "Three")]);
  });

  it("AC1: a blank line separates two runs of bullets into two lists", () => {
    expect(parseLegalDocument("- One\n- Two\n\n- Three")).toEqual([list("One", "Two"), list("Three")]);
  });

  it("AC1: blank lines separate blocks and are not blocks, however many there are", () => {
    expect(parseLegalDocument("\n\n## One\n\n\n\nTwo\n\n")).toEqual([heading("One"), paragraph("Two")]);
  });

  it("AC1: each line is its own block when no blank line comes between them", () => {
    expect(parseLegalDocument("## One\n- Two\n- Three\nFour\nFive\n## Six")).toEqual([
      heading("One"),
      list("Two", "Three"),
      paragraph("Four"),
      paragraph("Five"),
      heading("Six"),
    ]);
  });
});

describe("AC3 — each legal text is its own file, imported into the catalog", () => {
  it.each(["legal-terms", "legal-privacy"])("AC3: %s.en.ts is its own file, imported into the English catalog", (name) => {
    const catalog = readFileSync(new URL("./messages/en.ts", import.meta.url), "utf8");
    expect(catalog).toMatch(new RegExp(`from "\\./${name}\\.en\\.js"`));
  });
});

describe("AC2 — the Privacy Policy's opening", () => {
  it("AC2: its first block is the opening paragraph, before its first heading", () => {
    const blocks = parseLegalDocument(en["legal.privacy.text"]);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(blocks[1]).toEqual(heading("What we collect"));
  });
});

describe("AC7 — the paths", () => {
  it("AC7: TERMS_PATH is /terms and PRIVACY_PATH is /privacy, where the core can read them", () => {
    expect([TERMS_PATH, PRIVACY_PATH]).toEqual(["/terms", "/privacy"]);
  });
});
