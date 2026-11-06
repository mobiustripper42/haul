/**
 * The `members` seed: three members (eric, linked, duplicates) and an admin (lenny), all in English, each with a
 * name and phone and a confirmed email, so a fresh database seeds no unconfirmed member (issue #55).
 * linked@ocf.xx and duplicates@ocf.xx are the members issue 56's by-hand checks sign up as, against the
 * Square customers `npm run square:seed` makes for them. It puts back only the
 * columns it names, so a member's `id` and `created_at` survive a second run, and an email confirmed
 * earlier keeps its time.
 */
import type { Client } from "../../src/adapters/pg-connect.js";

export async function seed(db: Client): Promise<void> {
  await db.query(
    `insert into members (email, language, role, first_name, last_name, phone, email_confirmed_at)
     values ('eric@ocf.xx', 'en', 'member', 'Eric', 'Stoffer', '216-555-0101', now()),
            ('lenny@ocf.xx', 'en', 'admin', 'Lenny', 'Luckadoo', '216-555-0102', now()),
            ('linked@ocf.xx', 'en', 'member', 'Linda', 'Linked', '216-555-0103', now()),
            ('duplicates@ocf.xx', 'en', 'member', 'Dupree', 'Duplicates', '216-555-0104', now())
     on conflict (email) do update
       set language = excluded.language,
           role = excluded.role,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           phone = excluded.phone,
           email_confirmed_at = coalesce(members.email_confirmed_at, excluded.email_confirmed_at)`,
  );
}
