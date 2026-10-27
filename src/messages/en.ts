// English is the source catalog: every key exists here, and other languages may lack some.
export const en = {
  "home.title": "OCF Member Portal",
  "home.coreCheck": "Core check: {amount}",
  "language.label": "Language",
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
