# Design handoff: OCF Member Portal (2026-11-03)

Visual specs from the claude.ai Design canvas "OCF Member Portal Screens". They are design mockups, not app code: build the real screens in the app's own stack and copy layout, copy text, colors and spacing from them. Replaces the 2026-10-30 handoff. Every frame is at the values in `design-system/tokens.json` as of this date (the 85% scale, 40px fields, 44px buttons); the canvas carries the same copy of that file.

## design-system/
- `tokens.json`: every color, type style, spacing step, radius and shadow, with contrast ratios in each `usage`. Source of truth for the app's theme. `docs/BRAND.md` says how the tokens are used and supersedes `README.md` where they differ.
- `README.md`: the handoff as uploaded on 2026-10-30. Superseded by `docs/BRAND.md`.
- Fonts: Montserrat 400/500/600 (body) and Oswald 400/500 (headings), vendored in `app/fonts/`. No logo files yet; "OHIO CITY FARM" in Oswald, teal, is the stand-in.
- The app is multilingual (all strings in translation files). The mockups show an English/Español switch as an example only; no language beyond English is promised.

## screens/approved/
Every Phase 1 screen (Eric, 2026-11-03), plus sign in (Eric, 2026-10-27). One source file per screen; the other files only mount it at desktop (1280) or mobile (390) width with props that pick a state. File names are the canvas's, so a repo file and a canvas artboard match by name.

**Words.** The spec gives almost no screen wording, so most strings are proposed, marked as such on each row's orange sticky on the canvas and repeated below. Strings the app already has in `src/messages/` are used as they are: "Email me a code", "6-digit code", "Send a new code", "Use a different email". Where a frame and `docs/SPEC.md` disagree, the spec is right.

**Chrome.** Every page has the header (wordmark, byline, language switch), the footer (address; Terms, Privacy, Contact), a `surface-alt` page with a 16px gutter and content at most 960px wide. Whether the app builds the footer is still issue #20.

### Sign in (2026-10-27)
- `SignIn.dc.html` is the one source. Props `startStep` (email | code) and `error` (none | wrong | expired | locked) pick the state; `SignInCode`, `SignInMobile`, `SignInMobileCode` and the three `SignInErr*` files mount it.
- Step 1: email, then "Email me a code". Step 2: "Check your email", one 6-digit field (`inputmode=numeric`, `autocomplete=one-time-code`), "Sign in", "send a new code", "Use a different email".
- Errors: wrong code (field border turns danger), expired code and too many tries (primary button becomes "Send a new code").
- An unknown email shows NO error and goes to the code step like any other, so addresses cannot be probed. The code-step wording stays as is.

### Supper Club signup (tasks 1.3, 1.4, 1.5)
- `Main.dc.html` is the one source. Props: `step` (details | code | payment | soldout), `codeError` (none | wrong | expired | locked), `payError` (none | declined | soldout), `fieldErrors` (boolean). Mounts: `SignupMobile` (details, 390), `SignupCode`, `SignupPayment`, `SignupSoldOut` and their `SignupMobile*` pairs, and six `SignupErr*` files at 390.
- **Flow (Eric, 2026-11-03):** choices and details, then a 6-digit code to the email, then the card and the first charge. The member exists only after the code is confirmed. The code and payment steps hide the marketing column so the card is not under 900px of copy on a phone.
- **Details step.** Left: eyebrow "SUPPER CLUB · STARTS JANUARY 2027", title, intro and kitchen-team line from Lenny's copy (`docs/sources/2026-10-24-lenny-answers.md`, exclamation marks removed), the "Every week, a family-style portion of each" card, "A sample week" (menu 3 of Lenny's samples), the pickup line. Right card "Join the Supper Club": "1. How many people?" (2 people $50, 3–4 people $80), "2. Which menu?" (Standard, Vegan; "You can switch size or menu any week before the cutoff."), "3. Your details" (First name, Last name, Email with help, Phone with help "So the farm can reach you about your box.", "Language for emails"), then "Email me a code" and "Next we confirm your email. Then you add a card and pay for your first week." Pickers are generated from the option types (task 1.3); the two shown are the seeded ones.
- **Field errors:** danger border and a line under the field: "Enter a full email address, like name@example.com." / "Enter your phone number."
- **Code step.** The sign-in code card, alone: "Use a different email", "Check your email", "We sent a 6-digit code to {email}. Enter it to confirm your email.", the code field, "Confirm email", "No email? Check your spam folder, or send a new code." Errors as sign in's, with "sign-in" → "signup". The locked state copies sign in's wording; the signup wrong-guess limit (issue #22) has no behaviour yet.
- **Payment step.** Card alone, 560 wide: "Your box" and "Your details" rows with a quiet "Change" (back to details; a changed email is re-confirmed), the email marked "Confirmed" in success with a check; "4. Payment": "Card" (Square's card entry, drawn as a 40px field), "Secure card entry by Square. Your card is saved for the weekly charge.", the price panel ("Today, for your first week", "Then every week, at the cutoff", first pickup and the charge sentence), the consent checkbox, "Join and pay $50", "Limited to 50 boxes. No sales tax." The consent sentence and the how-to-cancel line are placeholders for task 1.12.
- **Declined:** a danger notice above the pay button: "Your card was declined. Nothing was charged. Check the card details or try another card."
- **Sold out** (`step=soldout`): card alone: "The Supper Club is sold out", "All 50 boxes are taken right now. A box opens when a member cancels, so check back.", "Questions? Email the farm at [SENDER ADDRESS].", "Back to ohiocityfarm.com". `payError=soldout` adds the notice "The last box was taken while you were paying. Nothing was charged." The cap counts boxes, not members (Eric, 2026-11-03).
- Not in `components/ui/`: the option picker, a select, field error text, a checkbox with label, the card entry box, the summary rows and price panel, the marketing column's eyebrow, panel and list card, a secondary button rendered as a link.

### Signup confirmation (tasks 1.3, 1.6)
- `SignupDone.dc.html` (+ `SignupDoneMobile`): the page after a successful signup. Header carries "Your account" beside the language switch. Done mark, "You're in the Supper Club", "Thank you, {firstName}. We emailed a confirmation to {email}.", the "Your box" card (SIZE, MENU, PAID TODAY, THEN; first pickup and pickup line), "What happens next" (three steps), "Go to your account", "Back to ohiocityfarm.com".
- "Go to your account" lands on the home page until the Phase 2 account pages exist (Eric, 2026-11-03: leave it). Step 3 of "What happens next" assumes those pages.
- `ConfirmEmail.dc.html`: the welcome email sent at signup, one frame (an email has no desktop/mobile pair). Always sends (no unsubscribe). Not the per-charge receipt (spec open question 14). Sender address is a placeholder (spec question 16). Footer carries Terms and Privacy (spec §7.12).

### Admin: members (task 1.7)
- `AdminMembers.dc.html` is the source; prop `members` (sample | none). Mounts: `AdminMembersMobile`, `AdminMembersEmpty`, `AdminMembersMobileEmpty`.
- Header: wordmark with "Admin · by Re:Source Cleveland", nav MEMBERS, MENUS, WEEKS, WEEKLY LISTS, HANDBOOK, SIGN OUT (the Phase 2 screens included, Eric 2026-11-03), language switch. Nav items are the `label` style, so `teal`, not `teal-muted` (`docs/BRAND.md`: teal-muted only at 14px and up); the current one sits on `sage-soft`.
- "Supper Club members", "{n} of 50 boxes taken · {m} members, including cancelled" (cancelled members do not count), "Download spreadsheet" as a secondary button (gold is for the page's primary action, and here that is reading the list).
- One card: Search ("Name, email or phone"; matches name, email or phone), then the table. Sort by Name, Box, Joined (newest first) or Status (card declined first); clicking a sorted header reverses it. No filters. Cells are the `small` style; names are not links (no detail page in Phase 1; plan 1.7 is list and CSV). Status badges: Active (success on sage-soft), Card declined (danger on danger-soft), Cancelled (ink-muted on surface-alt).
- Below 720px the table becomes rows inside the card with a "Sort by" select.
- Empty: "No members match \"{q}\"." and, with no members at all, the card "No members yet" / "The first signup appears here, with search, sorting and the spreadsheet."
- Sample data is made up. Not in `components/ui/`: the data table with sortable headers, the search field with icon, the status badge, a select, the row list.

### Terms and privacy (task 1.12)
- `Legal.dc.html` is the source; prop `page` (terms | privacy). Mounts: `LegalPrivacy`, `LegalMobile`, `LegalPrivacyMobile`.
- A 640px card: "Terms of service" or "Privacy policy", "Last updated [DATE]", then the farm's own text (spec open question 17) as [LEGAL TEXT], [SECTION HEADING] and [SECTION TEXT] placeholders, and "Questions about this page? Email the farm at [SENDER ADDRESS]." Nothing new: heading, section headings, card, footer.

## Placeholders in every screen
Prices ($50 for 2 people, $80 for 3–4), [FIRST PICKUP DATE], [PICKUP HOURS], [SENDER ADDRESS] and [DATE] wait on OCF; the consent wording waits on task 1.12; the legal text on open question 17.

## Reading a .dc.html
Plain HTML with inline styles inside `<x-dc>`. `{{name}}` holes and `<sc-if>` / `<sc-for>` are the mock's template syntax; the class at the bottom shows the state logic (steps, sorting, search). A mount file holds a `<dc-import name="X" …>` whose attributes are the source's props. `support.js` belongs to the canvas runtime and is not included, so the files will not render standalone.
