// Test-only: the two legal texts as issue 63 defines them, worked out from the stand-in documents in
// docs/sources/ and the edits under the issue's "The text". An edit whose words are not in the source, once,
// throws, so a mistyped one cannot pass by changing nothing. Nothing that ships imports this.
import { readFileSync } from "node:fs";

type Edit = readonly [from: string, to: string];

const TERMS_EDITS: Edit[] = [
  ["# Terms of Service\n", ""],
  ["Nov 6, 2026 · @Eric\n", ""],
  ["Effective \\[EFFECTIVE DATE\\]\n", ""],
  ["By creating an account or making a purchase, you agree", "By subscribing or making a purchase, you agree"],
  ["\\[14\\]", "14"],
  ["that week's box or share", "that week's meal or share"],
  ["your next week is free", "the next week you take is without charge"],
  ["prepare your box", "prepare your meal"],
  ["we may pause your subscription", "we may cancel your subscription"],
  [
    "Supper Club charges are not refunded once the cutoff has passed, except when we close a week as described above.",
    "Supper Club charges are not refunded once the cutoff has passed. If we close a week after its cutoff and you cancel before using the free week, we refund that week.",
  ],
];

const PRIVACY_EDITS: Edit[] = [
  ["# Privacy Policy\n", ""],
  ["Effective \\[EFFECTIVE DATE\\]\n", ""],
  ["We keep only what Square returns to us, such as the card brand, the last four digits and the expiry date.", "We keep only Square's reference to your card."],
  [
    "a sign-in cookie and the basic records our hosting provider keeps automatically, such as IP address and browser type, to keep the portal secure and working.",
    "your IP address, which we use to limit sign-in attempts, the cookies described below, and the basic records our hosting provider keeps automatically, such as IP address and browser type, to keep the portal secure and working.",
  ],
  ["To call or message you", "To call or email you"],
  ["with the unsubscribe link in any menu email or in your account", "with the unsubscribe link in any menu email"],
  [
    "The portal uses one cookie to keep you signed in.",
    "The portal uses some cookies it needs to work: to keep you signed in, to finish signing in or creating an account, and to remember your language.",
  ],
  [
    "We keep your account information while you are a member and for a reasonable time after, so you can come back",
    "We keep your account information while you are a member and afterwards, until you ask us to close your account, so you can come back",
  ],
  ["tell you what we must keep", "tell you what we keep"],
];

/** The document's lines with text on them, markers kept, after its edits and the two that apply to both. */
function linesOf(file: string, edits: Edit[]): string[] {
  let text = readFileSync(new URL(`../docs/sources/${file}`, import.meta.url), "utf8");
  for (const [from, to] of edits) {
    const found = text.split(from).length - 1;
    if (found !== 1) throw new Error(`${file}: "${from}" is there ${found} times, not once`);
    text = text.replace(from, () => to);
  }
  return text
    .replaceAll("**", "")
    .replace(/\\([[\]])/g, "$1")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

export const TERMS_LINES = linesOf("2026-11-06-terms-of-service-stand-in.md", TERMS_EDITS);
export const PRIVACY_LINES = linesOf("2026-11-06-privacy-policy-stand-in.md", PRIVACY_EDITS);

/** A document line without its `## ` or `- ` marker: the words a reader sees. */
export const wordsOf = (line: string): string => line.replace(/^(## |- )/, "");
