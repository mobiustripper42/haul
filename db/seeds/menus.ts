/**
 * The `menus` seed (issue 140): Lenny's four sample menus (`docs/sources/2026-10-24-lenny-answers.md:42`), split into
 * a Standard and a Vegan text, one dish per line. The first two are put on the calendar's first two weeks, worked out
 * from now as the admin calendar lists them; the others on none. It runs the `supper-club` seed first, so it needs
 * nothing else loaded. Re-runnable: a menu is found by its name and kept (its id survives), its texts put back, and
 * its assignments replaced by the ones above.
 */
import type { Client } from "../../src/adapters/pg-connect.js";
import { upcomingWeeks } from "../../src/pickup-week.js";
import { SUPPER_CLUB_PRODUCT_NAME } from "../../src/products.js";
import { seed as supperClub } from "./supper-club.js";

const MENUS: ReadonlyArray<{ name: string; texts: Readonly<Record<"Standard" | "Vegan", string>> }> = [
  {
    name: "Cajun red beans",
    texts: {
      Standard: [
        "Cajun Red Beans and Smoked Sausage",
        "Jasmine Rice (uncooked with instructions)",
        "Sherry Braised Vegan Collard Greens",
        "Cabbage Slaw",
        "Potato Onion Soup",
      ].join("\n"),
      Vegan: [
        "Vegan Cajun Red Beans",
        "Jasmine Rice (uncooked with instructions)",
        "Sherry Braised Vegan Collard Greens",
        "Cabbage Slaw",
        "Potato Onion Soup",
      ].join("\n"),
    },
  },
  {
    name: "Shakshuka",
    texts: {
      Standard: ["Egg Shakshuka", "Pita", "Za'atar Roasted Root Mix", "Carrot Fennel Salad with feta", "Lentil Soup"].join("\n"),
      Vegan: ["Ful Maddamas", "Pita", "Za'atar Roasted Root Mix", "Carrot Fennel Salad with roasted chickpeas", "Lentil Soup"].join("\n"),
    },
  },
  {
    name: "Shish tawook",
    texts: {
      Standard: [
        "Shish Tawook Chicken Skewers",
        "Mujadara Rice and Lentils with Onions (uncooked with instructions)",
        "Roasted/Grilled Squash",
        "Shredded Carrot and Walnut Salad with Sumac",
        "Butternut Squash Soup",
      ].join("\n"),
      Vegan: [
        "Lebanese Chickpea Moussaka",
        "Mujadara Rice and Lentils with Onions (uncooked with instructions)",
        "Roasted/Grilled Squash",
        "Shredded Carrot and Walnut Salad with Sumac",
        "Butternut Squash Soup",
      ].join("\n"),
    },
  },
  {
    name: "Chicken pulao",
    texts: {
      Standard: ["Chicken Drumstick Pulao", "Chapati", "Vegan Creamed Spinach", "Chickpea Chaat Salad with coconut shreds", "Home Style Chana Dal"].join("\n"),
      Vegan: ["Chana Masala and Rice", "Chapati", "Vegan Creamed Spinach", "Chickpea Chaat Salad with coconut shreds", "Home Style Chana Dal"].join("\n"),
    },
  },
];

/** How many of the menus above go on the calendar's first weeks, one each; the rest are on none. */
const ASSIGNED = 2;

export async function seed(db: Client): Promise<void> {
  await supperClub(db);

  const product = (
    await db.query<{ id: string; first_pickup: string; cutoff_weekday: number; cutoff_time: string }>(
      `select id, to_char(first_pickup_date, 'YYYY-MM-DD') as first_pickup, cutoff_weekday, cutoff_time::text as cutoff_time
         from products where name = $1`,
      [SUPPER_CLUB_PRODUCT_NAME],
    )
  ).rows[0];
  if (product === undefined) throw new Error("menus seed: the Supper Club product is missing");

  const options = await db.query<{ id: string; name: string }>(
    `select o.id, o.name
       from options o join option_types t on t.id = o.option_type_id
      where t.product_id = $1 and t.menu_texts`,
    [product.id],
  );
  const optionId = (name: string): string => {
    const found = options.rows.find((row) => row.name === name)?.id;
    if (found === undefined) throw new Error(`menus seed: the menu option "${name}" is missing`);
    return found;
  };

  const ids: string[] = [];
  for (const menu of MENUS) {
    const existing = await db.query<{ id: string }>("select id from menus where name = $1 order by created_at, id limit 1", [menu.name]);
    const id = existing.rows[0]?.id ?? (await db.query<{ id: string }>("insert into menus (name) values ($1) returning id", [menu.name])).rows[0]?.id;
    if (id === undefined) throw new Error("menus seed: the menu insert returned no id");
    ids.push(id);
    for (const [option, text] of Object.entries(menu.texts)) {
      await db.query(
        `insert into menu_texts (menu_id, option_id, text) values ($1, $2, $3)
         on conflict (menu_id, option_id) do update set text = excluded.text`,
        [id, optionId(option), text],
      );
    }
  }

  const weeks = upcomingWeeks(
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
  ).slice(0, ASSIGNED);
  const target = weeks.map((week, i) => ({ weekOf: week.weekOf, menuId: ids[i] ?? "" }));

  // Its own menus' assignments are replaced: any other week they were on goes.
  await db.query(
    `delete from week_menus
      where menu_id = any($1::uuid[])
        and not exists (select 1 from unnest($2::date[], $3::uuid[]) as t(week_of, menu_id)
                         where t.week_of = week_menus.week_of and t.menu_id = week_menus.menu_id and week_menus.product_id = $4)`,
    [ids, target.map((row) => row.weekOf), target.map((row) => row.menuId), product.id],
  );
  for (const { weekOf, menuId } of target) {
    await db.query(
      `insert into week_menus (product_id, week_of, menu_id) values ($1, $2::date, $3)
       on conflict (product_id, week_of) do update set menu_id = excluded.menu_id`,
      [product.id, weekOf, menuId],
    );
  }
}
