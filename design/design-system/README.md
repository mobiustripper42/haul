# OCF Member Portal

The OCF Member Portal is Ohio City Farm's Supper Club and CSA tool at members.ohiocityfarm.com. Members sign up, pay, skip and switch; Lenny and Michael build menus and pull the weekly lists. It takes its colors and type from ohiocityfarm.com (read 2026-10-27) and uses them more plainly than the Wix site does: the farm's palette and personality, a cleaner layout.

## Voice

The farm's site is warm and local: "Local Food, Global Flavor," "the best way to eat local in The Land!" The portal keeps the warmth and drops the flourish, because many members are not native English speakers and every string is translated.

- Do: short sentences, plain words, one idea per line. Say what happens and when: "Changes lock at the end of Monday."
- Do: name the farm's things the farm's way: Supper Club, CSA share, pickup, the farm store.
- Don't: idioms, puns, exclamation marks in the product, emoji, urgency ("Hurry!").
- Errors say what to do next: "Your card was declined. Update it to keep your box."

## Color

One light theme. teal is the brand and carries headings, links and focus. gold is the one accent and belongs to the primary action. Everything else is neutral.

- Primary button: `gold` fill, `on-gold` text (teal, 5.5:1), `radius-md`. Hover `gold-hover`. Never white text on gold (2.1:1); the Wix site does this and it is hard to read.
- Secondary button: `surface` fill, `teal` text and 1px `teal` border.
- Text: `ink` for body, `ink-muted` for help, `teal` for headings and links, `teal-muted` for nav at 14px and up.
- Fields: `border` (3.2:1) around inputs; `divider` (sage) only between rows.
- States: `success` for paid and confirmed, `danger` for declined and errors. Always pair a state color with a word or icon: success green and teal are close in lightness.
- Selected or current: `sage-soft` fill.

## Type

Two Google fonts, both already on ohiocityfarm.com. The site's third face, Adobe Caslon, is not used: it is licensed per site, and a serif body is harder to read on phones.

- `display` family, Oswald: page titles, screen titles, section headings. Sentence case in the product, so translated text reads naturally.
- `sans` family, Montserrat: everything else. Body is 16px minimum.
- `label` style is set in capitals with wide spacing, echoing the site's nav.

Load both from Google Fonts: Montserrat 400, 500, 600 and Oswald 400, 500.

## Layout and spacing

Every screen has a desktop and a mobile design; tablets use mobile. Spacing steps are `space-1` 4px to `space-12` 48px. Page gutter is `space-4` on phones and `space-6` on desktop. Cards: `surface`, `radius-md`, `shadow-card`, `space-4` padding on phones and `space-6` on desktop. Touch targets are at least 44px tall.

## Focus and accessibility

Keyboard focus is a 2px `teal` ring with a 2px gap in the page color. Text meets 4.5:1 on its stated grounds; control borders and icons meet 3:1. Each token's note lists its ratios.

## Imagery

- Logo: the farm's arched "OHIO CITY FARM" wordmark over the dome-and-skyline mark, with "by Re:Source Cleveland." Not yet in this system: drop the logo files here as a Logos group. Until then, set "Ohio City Farm" in `display`, `teal`.
- Illustrations: the site's black ink botanical drawings (carrot, parsley) suit empty pages and confirmations. Add them as an Illustrations group when the farm supplies the files.
- Photos: the farm with the skyline and bridge behind it. Public pages only, never behind text.

## Avoid

White text on gold. Caslon or any serif body. Gradients, emoji, colored left-border cards. More than one gold element per screen.
