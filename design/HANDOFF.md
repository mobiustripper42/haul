# Design handoff: OCF Member Portal (2026-11-03)

Visual specs from the claude.ai Design canvas "OCF Member Portal Screens". They are design mockups, not app code: build the real screens in the app's own stack and copy layout, copy text, colors and spacing from them. Replaces the 2026-10-30 handoff. Every frame is at the values in `design-system/tokens.json` as of this date (the 85% scale, 40px fields, 44px buttons); the canvas carries the same copy of that file.

## design-system/
- `tokens.json`: every color, type style, spacing step, radius and shadow, with contrast ratios in each `usage`. Source of truth for the app's theme. `docs/BRAND.md` says how the tokens are used and supersedes `README.md` where they differ.
- `README.md`: the handoff as uploaded on 2026-10-30. Superseded by `docs/BRAND.md`.
- Fonts: Montserrat 400/500/600 (body) and Oswald 400/500 (headings), vendored in `app/fonts/`. No logo files yet; "OHIO CITY FARM" in Oswald, teal, is the stand-in.
- The app is multilingual (all strings in translation files). The mockups show an English/Español switch as an example only; no language beyond English is promised.

## screens/approved/
One folder per canvas, because each canvas has its own `Main.dc.html`: `phase-1/` holds the canvas "OCF Member Portal Screens" (sign in, Eric 2026-10-27; every Phase 1 screen, Eric 2026-11-03) and `phase-2/` the canvas "OCF Member Portal Screens · Phase 2" (every Phase 2 screen, Eric 2026-11-03). One source file per screen; the other files only mount it at desktop (1280) or mobile (390) width with props that pick a state. File names are the canvas's, so a repo file and a canvas artboard match by name.

**Words.** The spec gives almost no screen wording, so most strings are proposed, marked as such on each row's orange sticky on the canvas and repeated below. Strings the app already has in `src/messages/` are used as they are: "Email me a code", "6-digit code", "Send a new code", "Use a different email". Where a frame and `docs/SPEC.md` disagree, the spec is right.

**Chrome.** Every page has the header (wordmark, byline, language switch), the footer (address; Terms, Privacy, Contact), a `surface-alt` page with a 16px gutter and content at most 960px wide. Whether the app builds the footer is still issue #20.

### Sign in (2026-10-27)
- `SignIn.dc.html` is the one source. Props `startStep` (email | code) and `error` (none | wrong | expired | locked) pick the state; `SignInCode`, `SignInMobile`, `SignInMobileCode` and the three `SignInErr*` files mount it.
- Step 1: email, then "Email me a code", then a quiet "No account yet? Create an account" above "Not a member yet? Join the Supper Club" (2026-11-05). Step 2: "Check your email", one 6-digit field (`inputmode=numeric`, `autocomplete=one-time-code`), "Sign in", "send a new code", "Use a different email".
- Errors: wrong code (field border turns danger), expired code and too many tries (primary button becomes "Send a new code").
- An unknown email shows NO error and goes to the code step like any other, so addresses cannot be probed. The code-step wording stays as is.

### Supper Club signup (tasks 1.3b, 1.4, 1.5)
- `Main.dc.html` is the one source. Props: `step` (details | soldout), `signedIn` (boolean), `payError` (none | declined | soldout). Mounts: `SignupMobile` (signed out, 390), `SignupSignedIn` (+ `SignupMobileSignedIn`), `SignupSoldOut` (+ `SignupMobileSoldOut`), and `SignupErrDeclined`, `SignupErrSoldOutPaying` at 390.
- **Flow (Eric, 2026-11-04, replacing 2026-11-03):** account first, then subscribe, on one page. The page shows the options to anyone and the pickers stay usable; subscribing is enabled only for a signed-in member. A visitor creates an account (below) or signs in, and either returns them here with their choices still picked. Signed in, the payment section sits in the same card under section 3; there is no separate payment step unless Square's card form turns out to need one (to be found at task 1.4). Task 1.3b builds the account; task 1.4 builds the payment section. The marketing column stays at every state; on a phone the card follows it.
- **Details step.** Left: eyebrow "SUPPER CLUB · STARTS JANUARY 2027", title, intro and kitchen-team line from Lenny's copy (`docs/sources/2026-10-24-lenny-answers.md`, exclamation marks removed), the "Every week, a family-style portion of each" card, "A sample week" (menu 3 of Lenny's samples), the pickup line. Right card "Join the Supper Club": "1. How many people?" (2 people $50, 3–4 people $80), "2. Which menu?" (Standard, Vegan; "You can switch size or menu any week before the cutoff."), then "3. Your account". Pickers are generated from the option types (task 1.3b); the two shown are the seeded ones.
- **Signed out:** "3. Your account", "Sign in or create an account to join. Your choices stay as you left them.", then "Create an account" (primary, the page's one gold element) and "Sign in" (secondary) side by side; at 390 they stack full width, primary first. The header carries "Sign in".
- **Signed in** (`signedIn`): the header shows "Your account" beside the language switch, as `SignupDone` does. Section 3: "Signed in as {email}." Then, in the same card:
- **Payment section** (task 1.4), under section 3: "4. Payment": "Card" (Square's card entry, drawn as a 40px field), "Secure card entry by Square. Your card is saved for the weekly charge.", the price panel ("Today, for your first week", "Then every week, at the cutoff", first pickup and the charge sentence), the consent checkbox, "Join and pay $50", "Limited to 50 boxes. No sales tax." The consent sentence and the how-to-cancel line are placeholders for task 1.12.
- **Declined:** a danger notice above the pay button: "Your card was declined. Nothing was charged. Check the card details or try another card."
- **Sold out** (`step=soldout`): this card replaces the form card in the second panel, beside the marketing column at desktop and after it on a phone: "The Supper Club is sold out", "All 50 boxes are taken right now. A box opens when a member cancels, so check back.", "Questions? Email the farm at [SENDER ADDRESS].", "Back to ohiocityfarm.com". `payError=soldout` adds the notice "The last box was taken while you were paying. Nothing was charged." The cap counts boxes, not members (Eric, 2026-11-03).
- Not in `components/ui/`: the option picker, a checkbox with label, the card entry box, the price panel, the marketing column's eyebrow, panel and list card, two buttons side by side that stack full width on a phone, a secondary button rendered as a link.

### Create account (task 1.3b)
- `CreateAccount.dc.html` is the one source. Props: `step` (details | code), `codeError` (none | wrong | expired | locked), `fieldErrors` (boolean). Mounts: `CreateAccountCode`, `CreateAccountMobile`, `CreateAccountMobileCode`, and `CreateAccountErrFields`, `CreateAccountErrWrong`, `CreateAccountErrExpired`, `CreateAccountErrLocked` at 390.
- Sign in's layout: one card, centred, 376 wide (`card`), the public header with the language switch, the footer.
- **Details step.** "Create your account"; First name and Last name side by side at desktop, stacked at 390; Email with "This is how you sign in: we email you a 6-digit code, no password."; Phone with "So the farm can reach you."; "Language for emails" (select); "Email me a code"; a quiet line "Already have an account? Sign in", "Sign in" the link.
- **Field errors:** danger border and a line under each field: "Enter your first name." / "Enter a full email address, like name@example.com." / "Enter your phone number."
- **Code step.** Sign in's code card as it is: "Use a different email", "Check your email", "We sent a 6-digit code to {email}. Enter it to confirm your email.", the code field, "Confirm email", "No email? Check your spam folder, or send a new code." Errors as sign in's, with "sign-in" → "account"; the locked one reads "For your safety, creating an account with this email is paused. Wait a few minutes, then send yourself a new code." and mentions no sign-in link. The account wrong-guess limit is issue #22; final locked wording comes from the spec.
- A confirmed code creates the member and returns them to the page they came from (the Supper Club page, with their choices), signed in. No frame.
- Every string is proposed except "Email me a code", "6-digit code", "Send a new code" and "Use a different email" (`src/messages/`). Not in `components/ui/`: a select, field error text.

### Create account and sign in, in the pane (task 1.3b, desktop)
- On desktop, "Create an account" and "Sign in" in section 3, and the header's "Sign in", open the form in the Supper Club page's right pane; the marketing column does not move. Phones keep the full-page `CreateAccount` and `SignIn` cards, unchanged.
- `Main.dc.html` is the one source, with new props `pane` (none | create | signin), `paneStep` (form | code), `codeError` (none | wrong | expired | locked) and `fieldErrors` (boolean). Mounts, all at 1280: `SignupPaneCreate`, `SignupPaneCreateErrFields`, `SignupPaneCreateCode`, `SignupPaneCreateErrWrong`, `SignupPaneCreateErrExpired`, `SignupPaneCreateErrLocked`, `SignupPaneSignIn`, `SignupPaneSignInCode`, `SignupPaneSignInErrWrong`, `SignupPaneSignInErrExpired`, `SignupPaneSignInErrLocked`.
- The panes carry `CreateAccount`'s and `SignIn`'s words in their order, at the current tokens. The details and email steps open with a quiet back link, "Back to your choices", in the style of "Use a different email"; the picks are kept. The code steps keep "Use a different email". "Already have an account? Sign in" and "No account yet? Create an account" switch panes. The sign-in pane drops "Not a member yet? Join the Supper Club", which would point at the page it sits on.
- **Width:** the pane keeps the Join panel's width (about 508px at 1280) and the form fills it, as the pickers do. First name and Last name stay side by side.
- **Header "Sign in":** while the sign-in pane shows, it is marked current (`sage-soft` fill) and pressing it returns the pane to the email step. From the create pane it switches to sign in.
- A confirmed code closes the pane and shows the signed-in card with the payment section, choices kept. No frame.
- Proposed: "Back to your choices", "No account yet? Create an account". New components: none.

### Signup confirmation (tasks 1.3b, 1.6)
- `SignupDone.dc.html` (+ `SignupDoneMobile`): the page after a successful signup. Header carries "Your account" beside the language switch. Done mark, "You're in the Supper Club", "Thank you, {firstName}. We emailed a confirmation to {email}.", the "Your box" card (SIZE, MENU, PAID TODAY, THEN; first pickup and pickup line), "What happens next" (three steps), "Go to your account", "Back to ohiocityfarm.com".
- "Go to your account" lands on the home page until the Phase 2 account pages exist (Eric, 2026-11-03: leave it). Step 3 of "What happens next" assumes those pages.
- `ConfirmEmail.dc.html`: the welcome email sent at signup, one frame (an email has no desktop/mobile pair). Always sends (no unsubscribe). Not the per-charge receipt (spec open question 14). Sender address is a placeholder (spec question 16). Footer carries Terms and Privacy (spec §7.12).

### Admin: members (task 1.7)
- `AdminMembers.dc.html` is the source; prop `members` (sample | none). Mounts: `AdminMembersMobile`, `AdminMembersEmpty`, `AdminMembersMobileEmpty`.
- Header: wordmark with "Admin · by Re:Source Cleveland", nav MEMBERS, MENUS, WEEKS, WEEKLY LISTS, HANDBOOK, SIGN OUT (the Phase 2 screens included, Eric 2026-11-03), language switch. Nav items are the `label` style, so `teal`, not `teal-muted` (`docs/BRAND.md`: teal-muted only at 14px and up); the current one sits on `sage-soft`.
- "Supper Club members", "{n} of 50 boxes taken · {m} members, including cancelled" (cancelled members do not count), "Download spreadsheet" as a secondary button (gold is for the page's primary action, and here that is reading the list).
- One card: Search ("Name, email or phone"; matches name, email or phone), then the table. Sort by Name, Box, Joined (newest first) or Status (card declined first); clicking a sorted header reverses it. No filters. Cells are the `small` style. Names link to the Phase 2 member page (`phase-2/AdminMember.dc.html`); the frame draws them plain because Phase 1 has no page to link to. Status badges: Active (success on sage-soft), Card declined (danger on danger-soft), Cancelled (ink-muted on surface-alt).
- Below 720px the table becomes rows inside the card with a "Sort by" select.
- Empty: "No members match \"{q}\"." and, with no members at all, the card "No members yet" / "The first signup appears here, with search, sorting and the spreadsheet."
- Sample data is made up. Not in `components/ui/`: the data table with sortable headers, the search field with icon, the status badge, a select, the row list.

### Terms and privacy (task 1.12)
- `Legal.dc.html` is the source; prop `page` (terms | privacy). Mounts: `LegalPrivacy`, `LegalMobile`, `LegalPrivacyMobile`.
- A 640px card: "Terms of service" or "Privacy policy", "Last updated [DATE]", then the farm's own text (spec open question 17) as [LEGAL TEXT], [SECTION HEADING] and [SECTION TEXT] placeholders, and "Questions about this page? Email the farm at [SENDER ADDRESS]." Nothing new: heading, section headings, card, footer.

## screens/approved/phase-2/ (Eric, 2026-11-03)
Every Phase 2 screen with a face: the member's account pages, the public menu page, the admin screens for weeks, menus, weekly lists and a member, and three emails. No screen for 2.2, 2.11, 2.12, 2.15 (the handbook is a document) or 2.16. Sample dates are January to March 2027; the sample member is Maria Lopez, 2 people · Standard, $50.

**Decisions (Eric, 2026-11-03).** A skip is one week per row, no range or pause; a long break is a cancel. A switch of size or menu applies from the next unpaid week on, so it sits above the list, not on a row. The admin does not edit menu translations this version. Dates read "January 17 or 18" and cutoffs "the end of Monday, January 18".

**Chrome.** Member pages get a nav in the header, the `label` style in `teal`: YOUR BOX, UPCOMING WEEKS, HISTORY, YOUR DETAILS, SIGN OUT, then the language switch. Admin pages keep the Phase 1 nav. Below 720px both collapse to a MENU button (three-line icon) that drops a panel with the items stacked and the language switch under a divider; `AccountHomeMobileMenu` and `AdminWeeksMobileMenu` show it open. The menu page and the unsubscribe page use the public chrome with "Sign in". Every file carries a `menu` prop (closed | open) for that panel.

### Your box (2.4; the declined banner of 2.13; the cancelled state of 2.7)
- `Main.dc.html` is the source; prop `status` (active | declined | cancelled). Mounts: `AccountHomeMobile`, `AccountHomeMobileMenu`, `AccountHomeDeclined` (+ `Mobile`), `AccountHomeCancelled` (+ `Mobile`).
- "Your box" is the page for the spec's "subscription": the box card ("2 people · Standard", a status badge, "Pickup Sunday or Monday, [PICKUP HOURS], at the farm store, 2304 Bridge Ave.", "$50 a week, charged at the end of each Monday for the following week's pickup. Changes for a week lock at that Monday's end.", "Skip or switch a week"), then "Card on file" (Visa ending 4242, "Update card") and "Your details" ("Edit details") side by side, then the quiet "Cancel the Supper Club".
- Declined: the brand doc's notice, "Your card was declined. Update it to keep your box. Your box for February 7 or 8 is still made.", then "Update your card". Cancelled: "Your Supper Club is cancelled. Your last pickup was January 17 or 18. Nothing more is charged. You can join again any time while there are boxes."; the skip and cancel actions go.

### Upcoming weeks (2.4, 2.5, 2.6)
- `Weeks.dc.html`; prop `panel` (closed | open). Mounts: `WeeksMobile`, `WeeksSwitch` (+ `WeeksMobileSwitch`).
- "Skip or switch until the end of the Monday before pickup. A skipped week is not charged." A card "YOUR BOX · 2 people · Standard · $50 a week" with "Switch size or menu", which opens the signup pickers in the card: "Applies from January 24 on. Weeks already paid stay as they are.", "Save", "Cancel".
- One row per week: the dates, the menu name or "Menu coming", a note, a badge and a button. States: Paid (locked, no button), Coming ("Charged at the end of Monday, January 18", "Skip"), Skipped ("Skipped: not charged", "Unskip"), Closed ("The farm is closed: no pickup, no charge"), Week credit ("Week credit: made, not charged", "Skip").

### History (2.4)
- `History.dc.html` (+ `HistoryMobile`). "Every week since you joined, newest first. Charges show on your card as Ohio City Farm." One row per ledger week: dates, box, amount, a badge: Paid, Credit, or No box (skipped or closed). A declined week shows "Paid February 9, after a declined charge". No empty state: the signup charge is the first row.

### Your details (2.4)
- `Details.dc.html`; prop `step` (form | code | saved). Mounts: `DetailsMobile`, `DetailsCode` (+ `Mobile`), `DetailsMobileSaved`.
- First name, Last name, Email ("This is how you sign in. Changing it sends a 6-digit code to the new address, and it becomes your sign-in email once confirmed."), Phone, Language for emails, the checkbox "Email me the weekly menu" with "Sign-in codes, receipts and card notices always send." (spec §7.12), "Save". Saved: "Saved. Your details are up to date."
- A changed email goes to the code card, alone: "Keep the old email", "Check your new email", "We sent a 6-digit code to {new email}. Enter it to confirm the change. Until then you sign in with the old address.", the code field, "Confirm email", the spam line.

### Update your card (2.13)
- `UpdateCard.dc.html`; prop `state` (form | saved | retried | failed). Mounts: `UpdateCardMobile`, `UpdateCardRetried`, `UpdateCardMobileSaved`, `UpdateCardMobileFailed`.
- A 560px card: "Your box" back link, "On file now: Visa ending 4242. The new card replaces it for every charge from now on.", "New card" (Square entry), "Secure card entry by Square. Any unpaid weeks are charged to the new card when you save it.", "Save card".
- Saved: "Card saved. Your next charge, at the end of Monday, January 18, uses Visa ending 1881." Retried: "Card saved. We charged $100 to Visa ending 1881 for the 2 unpaid weeks: February 7–8 and February 14–15." Failed: "That card was declined. Nothing was charged and your old card stays on file. Check the details or try another card."

### Cancel (2.7)
- `Cancel.dc.html`; prop `credit` (none | one). Mounts: `CancelMobile`, `CancelMobileCredit`.
- "Cancel the Supper Club?", "Your last pickup is January 17 or 18, which you already paid for. Nothing more is charged.", "You can join again any time while there are boxes. If you only need a break, skip the weeks instead.", "Yes, cancel my Supper Club", "Skip weeks instead". With a credit: "You have 1 week credit. The farm refunds it in Square after you cancel. Email [SENDER ADDRESS] if you have not heard from them in a week." (DEC-005).

### Menu page (2.9)
- `Menu.dc.html`; prop `state` (menu | none). Mounts: `MenuMobile`, `MenuMobileNone`. Public, no sign-in.
- "SUPPER CLUB · THIS WEEK", "Menu for January 17 and 18" in the `display` style, the pickup line, then Standard and Vegan cards side by side (stacked on a phone), "Allergens are marked on the packaging. Some dishes come with one or two quick steps to finish at home.", and a sage-soft panel "Not a member? Weekly meals from the farm kitchen, $50 for 2 people." with "Join the Supper Club". No menu: "This week's menu is coming" / "The farm posts it a few days before pickup, and members get it by email."

### Menu emails off (2.9)
- `Unsubscribe.dc.html`; prop `state` (off | on). Mounts: `UnsubscribeMobile`, `UnsubscribeMobileOn`. The landing for the email's unsubscribe link, a 376px card: "Menu emails are off", "You won't get the weekly menu at name@example.com. Your box and your charges don't change, and the menu is always on this site.", "Turn menu emails back on"; on: "Menu emails are on", "Turn them off". "See this week's menu".

### Admin: weeks (2.1)
- `AdminWeeks.dc.html`; prop `confirm` (none | before | after). Mounts: `AdminWeeksMobile`, `AdminWeeksMobileMenu`, `AdminWeeksCloseBefore`, `AdminWeeksMobileCloseAfter`.
- "Weeks", the rule in one line, then one row per week: dates, "Cutoff: end of Monday, January 18", the menu name or "No menu yet" in danger, "31 boxes", a badge (Open, Moved window, Charged, Closed), "Close week". "Holiday closures and moved windows are set by the developer. Menus are assigned under Menus."
- Closing before the cutoff: a teal-edged card, "Close the week of January 24 and 25?", "Nobody has been charged for it. The charge at the end of Monday, January 18 is skipped, and members see the week as closed.", "Close the week" / "Keep it open". After: a danger-edged card, "31 members were charged for it at the end of Monday, January 11. Each gets a week credit: their next box is made and not charged. This cannot be undone.", "Close the week and give credits".

### Admin: menus (2.8)
- `AdminMenus.dc.html`; prop `view` (list | edit | empty). Mounts: `AdminMenusMobile`, `AdminMenuEdit` (+ `Mobile`), `AdminMenusMobileEmpty`.
- List: "Menus", "A menu has a standard text and a vegan text. Assign one to each week; members get it by email and on the menu page.", "New menu", a card with Search ("A dish or a menu name") and one row per menu: name, the sides, "Assigned to January 17 and 18" or "Not assigned to a week", "Edit", "Duplicate". Empty: "No menus yet" / "Make the first one with New menu…".
- Editor: "All menus" back, "Edit menu", a 640px card: "Menu name" ("Members see this as the week's title."), "Standard menu" and "Vegan menu" textareas ("One dish per line."), "Assigned to" select ("A week can have one menu. Assigning this one replaces the week's current menu."), "Save", "Duplicate". No translation controls.

### Admin: weekly lists (2.10)
- `AdminLists.dc.html` (+ `AdminListsMobile`); `AdminPickupPrint.dc.html` is the printable list, a letter page.
- "Weekly lists", "Counts are final after the week's cutoff. Before it, they change as members skip and switch.", a Week select, the card "Pick list · January 24 and 25" with a Final badge, a table SIZE · MENU · BOXES ending in "Boxes to make 29", "2 skipped · 1 week credit, counted above · 31 active members.", "Download pick list", "Download skips", "Print pickup list".
- The print page: the wordmark, "Supper Club pickup · January 24 and 25", "29 boxes · printed [DATE]", a table with a check box, NAME, BOX, NOTES, sorted by last name, and a line naming the skipped and credit members.

### Admin: member (2.7, 2.3)
- `AdminMember.dc.html`; props `status` (active | declined | cancelled) and `confirm` (none | open). Mounts: `AdminMemberMobile`, `AdminMemberCancel`, `AdminMemberMobileDeclined`.
- "All members" back, the name and a status badge, then Contact (email, phone, language, joined) and Subscription (box, card, "Open in Square", week credits) side by side, "Weeks" (three rows with badges), and "Cancel for this member". Declined: "Card declined at the end of Monday, February 1 for the week of February 7–8. The box is still made. They were emailed to update their card; nothing cancels on its own."
- Confirm: a danger-edged card, "Cancel the Supper Club for Chidi Abara?", "Their last pickup is January 17 or 18, already paid. Nothing more is charged, and they can sign up again. Do this only when they asked you to.", "Cancel their Supper Club" / "Keep it".

### Emails (2.3, 2.9, 2.8)
- `EmailDeclined.dc.html`: "Your card was declined", "We could not charge $50 for your box for February 7 or 8. Your box is still made. Pick it up as usual.", "Update your card so next week's charge goes through. The unpaid week is charged when you save a new card.", "Update your card", "Your Supper Club keeps going, week after week, until you cancel it."
- `EmailMenu.dc.html`: "This week's Supper Club menu", both menus in sage-soft panels, "Your box: 2 people · Standard" and the pickup line, "The week after is charged at the end of Monday, January 18. To skip or switch it, sign in before then.", "Skip or switch a week"; the footer carries "Turn off the menu email" (the only email that can be, spec §7.12).
- `EmailMissingMenu.dc.html`, to the admins: "No menu yet for January 24 and 25", "The menu email to members goes out on [MENU EMAIL DAY]… Assign a menu to the week in the portal.", "Assign a menu", "Sent to the admins once a day while a week within [DAYS] days has no menu." Both placeholders are settings not yet decided.

**Not in `components/ui/`** beyond the Phase 1 list: the header nav and its mobile menu panel, the row list with a badge and a button, the status badge in four kinds, a success notice and a neutral notice (Notice has danger icons only, issue #45), a confirm card with a coloured edge, a textarea, a data table, a print layout.

## Placeholders in every screen
Prices ($50 for 2 people, $80 for 3–4), [FIRST PICKUP DATE], [PICKUP HOURS], [SENDER ADDRESS] and [DATE] wait on OCF; the consent wording waits on task 1.12; the legal text on open question 17; [MENU EMAIL DAY] and [DAYS] on task 2.8's spec.

## Reading a .dc.html
Plain HTML with inline styles inside `<x-dc>`. `{{name}}` holes and `<sc-if>` / `<sc-for>` are the mock's template syntax; the class at the bottom shows the state logic (steps, sorting, search). A mount file holds a `<dc-import name="X" …>` whose attributes are the source's props. `support.js` belongs to the canvas runtime and is not included, so the files will not render standalone.
