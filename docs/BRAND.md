# Ohio City Farm Member Portal — Brand Direction

Written from the 2026-10-30 handoff's `design/design-system/README.md`, on the points below where the approved sign-in frames (`design/screens/approved/`) and that README disagree, the frame's side (Eric, 2026-10-30). Every value named here is a token in `design/design-system/tokens.json`; `app/globals.css` rebuilds Tailwind's theme from it and `app/theme.test.ts` holds the two together (DEC-020).

## Name

The product is **Ohio City Farm**, by Re:Source Cleveland. "Haul" is the project's internal name and appears nowhere a member can see.

## Philosophy

The portal is Ohio City Farm's Supper Club and CSA tool at members.ohiocityfarm.com. It takes its colours and type from ohiocityfarm.com (read 2026-10-27) and uses them more plainly than the Wix site does: the farm's palette and personality, a cleaner layout.

## Voice

The farm's site is warm and local: "Local Food, Global Flavor," "the best way to eat local in The Land!" The portal keeps the warmth and drops the flourish, because many members are not native English speakers and every string is translated.

- Do: short sentences, plain words, one idea per line. Say what happens and when: "Changes lock at the end of Monday."
- Do: name the farm's things the farm's way: Supper Club, CSA share, pickup, the farm store.
- Don't: idioms, puns, exclamation marks in the product, emoji, urgency ("Hurry!").
- Errors say what to do next: "Your card was declined. Update it to keep your box."

The mockups own look and position; the spec owns the words. Where a frame and the spec disagree on a word, the spec is right.

## Visual Direction

- **Theme:** one light theme.
- **Font:** Oswald for titles (`display` family), Montserrat for everything else (`sans` family). Both load from files in the repo, not from Google.
- **Border radius:** `radius-sm` 4px for inputs, `radius-md` 8px for buttons and cards, `radius-lg` 16px for sheets and large panels.
- **Shadows:** `shadow-card` on cards, `shadow-modal` on dialogs and sheets, nothing else.
- **Colour approach:** token utilities only (`bg-surface`, `text-ink`); no Tailwind default colour exists and no raw hex or arbitrary value passes lint.

### Colour

teal is the brand and carries headings, links and focus. gold is the one accent and belongs to the primary action. Everything else is neutral.

- Primary button: `gold` fill, `on-gold` text (teal, 5.5:1), `radius-md`. Hover `gold-hover`. Never white text on gold (2.1:1); the Wix site does this and it is hard to read.
- Secondary button: `surface` fill, `teal` text and 1px `teal` border.
- Quiet button: no fill, `teal` text, for in-line actions and the language switch.
- Text: `ink` for body, `ink-muted` for help, `teal` for headings and links, `teal-muted` for nav at 14px and up.
- Fields: a `border` (3.2:1 on `surface`) around inputs; `divider` (sage) only between rows and sections.
- States: `success` for paid and confirmed, `danger` for declined and errors, with `danger-soft` as an alert's fill. Always pair a state colour with a word or icon: success green and teal are close in lightness.
- Never as text: `sage`, `divider`, `gold`, `gold-hover` and `border` fail 4.5:1 on `surface`. Lint refuses them (DEC-020).

**Fields sit on cards.** `border` is 3.18:1 on `surface` but 2.97:1 on `surface-alt`, under the 3:1 a control's edge needs, so a field is never drawn straight on the page. The README put fields on either; the frames put them on a white card.

**A current item is `teal` on `sage-soft`.** `teal-muted` is 4.09:1 on `sage-soft`, under 4.5:1; teal is 9.5:1. The README said "sage-soft fill" without naming the text.

### Type

Two faces, both already on ohiocityfarm.com. The site's third face, Adobe Caslon, is not used: it is licensed per site, and a serif body is harder to read on phones.

- `display` family, Oswald (400, 500): page titles, screen titles, section headings and the farm's wordmark. Sentence case in the product, so translated text reads naturally; the wordmark is set in capitals by CSS.
- `sans` family, Montserrat (400, 500, 600): everything else. Body is 14px (see the scale note below).
- **Field labels are 12px, weight 500, sentence case** (`field-label`). The README set them as `label`, 12px capitals; the frames do not. `label` is for nav items.

**The type and sizes are scaled to about 85% of the frame, phones included** (Eric, 2026-10-31: the frame and the first build were both too big; 83-85% browser zoom looked right). Body is 14px, not the README's 16px. The 16px minimum now applies to text inside a field, because iOS zooms into a field set smaller. Two other floors hold: nothing a person taps is under 40px tall, and no text is under 11px. `app/theme.test.ts` pins every value to `tokens.json`.

**Desktop with a mouse renders at 93.75%; phones and tablets at 100%** (Eric, 2026-10-31: desktop was still a little big after the 85% scale). Type, spacing and container lengths are written in rem, so the root size scales them and a reader's browser text size applies; the px in `tokens.json` are what they come to at a 100% root. Radius, shadow, borders and the focus ring stay px.

**Fonts load from files in the repo, not from Google.** `app/fonts/` holds the five static weights as woff2 beside each family's OFL licence, loaded through `next/font/local` in `app/fonts.ts`. The README says "Load both from Google Fonts"; `next/font/google` downloads during `next build`, which can fail a build on a network it has nothing to do with (DEC-020). Adding a weight means adding a file.

### Layout and spacing

Every screen has a desktop and a mobile design; tablets use mobile (DEC-008). Spacing steps are `space-1` 4px to `space-12` 48px, and Tailwind's own 4px step is kept.

- **Cards have 28px by 20px padding** (28px above and below, 20px at the sides), with 20px between their children, at every width. The README gave 16px on phones.
- **The page has a 16px gutter at every width.** The README gave 24px on desktop. Content is at most `page` (960px) wide; a focused card is at most `card` (376px).
- **Every control is at least 40px tall:** `field` 40px; `button`, `touch` and the language switcher 44px; `code-field` 52px. The README's 44px floor is lowered to 40px so the field stays 40 (Eric, 2026-10-31); the frame's switcher, at 40px, did not reach 44.

### Focus and accessibility

Keyboard focus is a 2px `teal` ring with a 2px gap in the page colour, set once for every control. Text meets 4.5:1 on its stated grounds; control borders and icons meet 3:1. Each token's note lists its ratios.

## Imagery

- Logo: the farm's arched "OHIO CITY FARM" wordmark over the dome-and-skyline mark, with "by Re:Source Cleveland." Not yet in this system. Until the files arrive, "Ohio City Farm" is set in the `wordmark` style, `teal`, with the byline beneath it.
- Illustrations: the site's black ink botanical drawings (carrot, parsley) suit empty pages and confirmations. Add them when the farm supplies the files.
- Photos: the farm with the skyline and bridge behind it. Public pages only, never behind text.

## Anti-patterns

White text on gold. Caslon or any serif body. Gradients, emoji, colored left-border cards. More than one gold element per screen. A field drawn on the page without a card.
