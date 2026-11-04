/**
 * The `supper-club` seed (issue #53): the Supper Club product, its two option types and four
 * options. Each row is upserted on its unique name and puts back only the columns it names, so an
 * `id` survives a second run and a row the seed doesn't name (another product, another option) is
 * left alone. Values are placeholders until the farm answers (`docs/SPEC.md` §6.1, §9).
 *
 * Cutoff is Monday (ISO weekday 1) at `24:00`, the end of the day, in America/New_York (DEC-017).
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";

const PRODUCT = {
  name: SUPPER_CLUB_PRODUCT_NAME,
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00",
};

const OPTION_TYPES: ReadonlyArray<{
  name: string;
  position: number;
  options: ReadonlyArray<{ name: string; priceCents: number; position: number }>;
}> = [
  {
    name: "Size",
    position: 1,
    options: [
      { name: "2 person", priceCents: 5000, position: 1 },
      { name: "3–4 person", priceCents: 8000, position: 2 },
    ],
  },
  {
    name: "Preference",
    position: 2,
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

  for (const type of OPTION_TYPES) {
    const row = await db.query<{ id: string }>(
      `insert into option_types (product_id, name, position)
       values ($1, $2, $3)
       on conflict (product_id, name) do update set position = excluded.position
       returning id`,
      [productId, type.name, type.position],
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
