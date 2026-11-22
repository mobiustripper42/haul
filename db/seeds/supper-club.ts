/**
 * The `supper-club` seed (issue #53): the Supper Club product, its two option types and four
 * options. Each row is upserted on its unique name and puts back only the columns it names, so an
 * `id` survives a second run and a row the seed doesn't name (another product, another option) is
 * left alone. Names, prices and the first pickup are Lenny's answers (`docs/sources/2026-11-07-lenny-answers.md`).
 *
 * Cutoff is Monday (ISO weekday 1) at `24:00`, the end of the day, in America/New_York (DEC-017).
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { MISSING_MENU_DAYS_DEFAULT, MISSING_MENU_DAYS_KEY, MISSING_NOTE_DAYS_DEFAULT, MISSING_NOTE_DAYS_KEY } from "../../src/settings.js";

const PRODUCT = {
  name: SUPPER_CLUB_PRODUCT_NAME,
  cap: 50,
  // Dev data, not Lenny's date (his first pickup weekend is January 10-11, 2027; production's date is not a seed,
  // DEC-007). Dev runs from Sunday, October 25, 2026 so the calendar has a past, and History has weeks to show.
  firstPickupDate: "2026-10-25",
  cutoffWeekday: 1,
  cutoffTime: "24:00",
};

/** Issue 231: the settings rows, by key. Production's are a hand-run insert (docs/RUNBOOK.md), since its seed runs once. */
const SETTINGS: Readonly<Record<string, string>> = {
  [MISSING_MENU_DAYS_KEY]: String(MISSING_MENU_DAYS_DEFAULT),
  [MISSING_NOTE_DAYS_KEY]: String(MISSING_NOTE_DAYS_DEFAULT),
};

const OPTION_TYPES: ReadonlyArray<{
  name: string;
  position: number;
  /** The type whose options each get a menu text (issue 140). */
  menuTexts: boolean;
  options: ReadonlyArray<{ name: string; priceCents: number; position: number }>;
}> = [
  {
    name: "How many people",
    position: 1,
    menuTexts: false,
    options: [
      { name: "Portioned for 4", priceCents: 7400, position: 1 },
      { name: "Portioned for 2", priceCents: 4200, position: 2 },
    ],
  },
  {
    name: "Which menu",
    position: 2,
    menuTexts: true,
    options: [
      { name: "Standard", priceCents: 0, position: 1 },
      { name: "Vegan", priceCents: 0, position: 2 },
    ],
  },
];

export async function seed(db: Client): Promise<void> {
  const product = await db.query<{ id: string }>(
    `insert into products (name, cap, first_pickup_date, cutoff_weekday, cutoff_time)
     values ($1, $2, $3, $4, $5)
     on conflict (name) do update
       set cap = excluded.cap,
           first_pickup_date = excluded.first_pickup_date,
           cutoff_weekday = excluded.cutoff_weekday,
           cutoff_time = excluded.cutoff_time
     returning id`,
    [PRODUCT.name, PRODUCT.cap, PRODUCT.firstPickupDate, PRODUCT.cutoffWeekday, PRODUCT.cutoffTime],
  );
  const productId = product.rows[0]?.id;
  if (productId === undefined) throw new Error("supper-club seed: the product upsert returned no id");

  // Issue 231: the two reminders' day counts (DEC-049), upserted on `key` like every row above.
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.query(
      `insert into settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`,
      [key, value],
    );
  }

  for (const type of OPTION_TYPES) {
    const row = await db.query<{ id: string }>(
      `insert into option_types (product_id, name, position, menu_texts)
       values ($1, $2, $3, $4)
       on conflict (product_id, name) do update set position = excluded.position, menu_texts = excluded.menu_texts
       returning id`,
      [productId, type.name, type.position, type.menuTexts],
    );
    const typeId = row.rows[0]?.id;
    if (typeId === undefined) throw new Error("supper-club seed: the option type upsert returned no id");

    for (const option of type.options) {
      await db.query(
        `insert into options (option_type_id, name, price_cents, position)
         values ($1, $2, $3, $4)
         on conflict (option_type_id, name) do update
           set price_cents = excluded.price_cents, position = excluded.position`,
        [typeId, option.name, option.priceCents, option.position],
      );
    }
  }
}
