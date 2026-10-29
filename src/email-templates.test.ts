// Issue 9, AC5: renderEmail. The Spanish catalog is replaced for this whole file by a stand-in
// whose every value is its own key in guillemets, so a Spanish render shows exactly which keys
// the template reads, and any English the template wrote itself shows up beside them. The bare-
// string lint rule covers .tsx only; this is the check for .ts templates.
import { describe, expect, it, vi } from "vitest";
import { renderEmail } from "./email-templates.js";

vi.mock("./messages/es.js", async () => {
  const { en } = await import("./messages/en.js");
  return { es: Object.fromEntries(Object.keys(en).map((key) => [key, `«${key}»`])) };
});

describe("AC5 (issue 9) — renderEmail", () => {
  it('AC5: signInCode in English returns exactly the subject and the body, a blank line, then the sign-off', () => {
    expect(renderEmail("signInCode", "en", { code: "042517", minutes: 10 })).toEqual({
      subject: "Your OCF Member Portal sign-in code",
      text:
        "Your sign-in code is 042517.\n\n" +
        "It expires in 10 minutes. If you didn't ask for it, you can ignore this email.\n\n" +
        "— Ohio City Farm",
    });
  });

  it("AC5: signInCode in the stand-in Spanish catalog returns only catalog values — nothing the template wrote itself", () => {
    expect(renderEmail("signInCode", "es", { code: "042517", minutes: 10 })).toEqual({
      subject: "«email.signInCode.subject»",
      text: "«email.signInCode.body»\n\n«email.signOff»",
    });
  });
});
