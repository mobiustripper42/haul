# Design handoff: OCF Member Portal (2026-10-30)

Visual specs from the claude.ai Design canvas "OCF Member Portal Screens". They are design mockups, not app code: build the real screens in the app's own stack and copy layout, copy text, colors and spacing from them. Replaces the 2026-10-27 handoff.

## design-system/
- `README.md`: voice, color rules, type, spacing, accessibility. Read first.
- `tokens.json`: every color, type style, spacing step, radius and shadow, with contrast ratios in each `usage`. Source of truth for the app's theme.
- Fonts: Montserrat 400/500/600 (body) and Oswald 400/500 (headings), Google Fonts. No logo files yet; "OHIO CITY FARM" in Oswald, teal, is the stand-in.
- The app is multilingual (all strings in translation files). The mockups show an English/Español switch as an example only; no language beyond English is promised.

## screens/approved/ (Eric, 2026-10-27)
Sign in.
- `SignIn.dc.html` is the one source. Props `startStep` (email | code) and `error` (none | wrong | expired | locked) pick the state; the other `SignIn*.dc.html` files only mount it at desktop (1280) or mobile (390) width.
- Step 1: email, then "Email me a code". Step 2: "Check your email", one 6-digit field (`inputmode=numeric`, `autocomplete=one-time-code`), "Sign in", "send a new code", "Use a different email".
- Errors: wrong code (field border turns danger), expired code and too many tries (primary button becomes "Send a new code").
- An unknown email shows NO error and goes to the code step like any other, so addresses cannot be probed. The code-step wording stays as is.

## screens/for-review/ (not yet approved; confirm with Eric before building)
- `SignupDone.dc.html` (+ `SignupDoneMobile`): page after a successful Supper Club signup. Box summary, first pickup, what happens next, "Go to your account".
- `ConfirmEmail.dc.html`: the welcome email sent at signup. Always sends (no unsubscribe). Not the per-charge receipt (spec open question 14). Sender address is a placeholder (spec question 16).
- `AdminMembers.dc.html` (+ `AdminMembersMobile`): admin member list (task 1.7).
  - Search matches name, email or phone. Sort by Name, Box, Joined (newest first) or Status (card declined first); clicking a sorted header reverses it. No filters.
  - Header shows spots taken out of 50 (cancelled members don't count) and a "Download spreadsheet" button.
  - Below 720px wide the table becomes cards with a "Sort by" select.
  - Member names link to a detail page that is not designed yet. Sample data is made up.

## screens/on-hold/
- Supper Club signup, desktop and mobile. Layout liked; Eric has changes pending. Do not build yet.
- Known gap: the spec now collects phone at signup, which this mockup does not show yet.

## Placeholders in every screen
Prices ($50 for 2 people, $80 for 3–4), [FIRST PICKUP DATE], [PICKUP HOURS] and [SENDER ADDRESS] wait on OCF.

## Reading a .dc.html
Plain HTML with inline styles inside `<x-dc>`. `{{name}}` holes and `<sc-if>` / `<sc-for>` are the mock's template syntax; the class at the bottom shows the state logic (sorting, search, steps). `support.js` belongs to the canvas runtime and is not included, so the files will not render standalone.
