/**
 * `template` with each `{name}` replaced by its value; a name with no value keeps its placeholder. For the words a
 * page has translated and a client list fills as the admin types. Not built on `translate` (`src/i18n.ts`): that
 * throws on a missing value, and importing it into a client component would send both message catalogs to the browser.
 */
export const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
