/**
 * The `members` seed: eric a member and lenny an admin, both in English, each with a name and phone and
 * a confirmed email, so a fresh database seeds no unconfirmed member (issue #55). It puts back only the
 * columns it names, so a member's `id` and `created_at` survive a second run, and an email confirmed
 * earlier keeps its time.
 */
import type { Client } from "../../src/adapters/pg-connect.js";

export async function seed(db: Client): Promise<void> {
  await db.query(
    `insert into members (email, language, role, first_name, last_name, phone, email_confirmed_at)
     values ('eric@ocf.xx', 'en', 'member', 'Eric', 'Stoffer', '216-555-0101', now()),
            ('lenny@ocf.xx', 'en', 'admin', 'Lenny', 'Luckadoo', '216-555-0102', now())
     on conflict (email) do update
       set language = excluded.language,
           role = excluded.role,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           phone = excluded.phone,
           email_confirmed_at = coalesce(members.email_confirmed_at, excluded.email_confirmed_at)`,
  );
}
