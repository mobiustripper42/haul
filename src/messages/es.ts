import type { MessageKey } from "./en.js";

// A key English lacks is a type error; a key missing here falls back to English.
export const es = {
  "home.title": "Portal de miembros de OCF",
  "home.coreCheck": "Comprobación del núcleo: {amount}",
  "language.label": "Idioma",
} satisfies Partial<Record<MessageKey, string>>;
