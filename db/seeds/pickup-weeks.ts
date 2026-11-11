/**
 * The `pickup-weeks` seed (issue 133): the Supper Club's first upcoming week, moved to Saturday and Sunday, for
 * AC7's by-hand check of the done box and the email in a moved week. The week is worked out from now by the same
 * rule signup uses, so it is never one whose cutoff has passed. It runs the `supper-club` seed first, so it needs
 * nothing else loaded. The row is upserted on its key, so a second run puts back the same row.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { firstPickup } from "../../src/pickup-week.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as supperClub } from "./supper-club.js";

/** The day before a `YYYY-MM-DD` Sunday: its Saturday. */
const saturdayBefore = (sunday: string): string => new Date(Date.parse(`${sunday}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function seed(db: Client): Promise<void> {
  await supperClub(db);

  const product = (
    await db.query<{ id: string; first_pickup: string; cutoff_weekday: number; cutoff_time: string }>(
      `select id, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup, cutoff_weekday, cutoff_time::text as cutoff_time
         from products where name = $1`,
      [SUPPER_CLUB_PRODUCT_NAME],
    )
  ).rows[0];
  if (product === undefined) throw new Error("pickup-weeks seed: the Supper Club product is missing");

  const week = firstPickup(
    {
      id: product.id,
      name: SUPPER_CLUB_PRODUCT_NAME,
      cap: 0,
      firstPickupDate: product.first_pickup,
      cutoffWeekday: product.cutoff_weekday,
      cutoffTime: product.cutoff_time,
      optionTypes: [],
    },
    new Date(),
    [],
  );

  await db.query(
    `insert into pickup_weeks (product_id, week_of, closed_at, note, first_day, last_day)
     values ($1, $2::date, null, $3, $4::date, $2::date)
     on conflict (product_id, week_of) do update
       set closed_at = excluded.closed_at, note = excluded.note, first_day = excluded.first_day, last_day = excluded.last_day`,
    [product.id, week.weekOf, "Moved to Saturday and Sunday (dev seed)", saturdayBefore(week.weekOf)],
  );
}
