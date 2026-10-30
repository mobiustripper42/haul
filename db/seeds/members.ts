/**
 * The `members` seed: eric a member and lenny an admin, both in English. It puts back only the
 * columns it names, so a member's `id` and `created_at` survive a second run.
 */
import type { Client } from "../../src/adapters/pg-connect.js";

export async function seed(db: Client): Promise<void> {
  await db.query(
    `insert into members (email, language, role)
     values ('eric@ocf.xx', 'en', 'member'), ('lenny@ocf.xx', 'en', 'admin')
     on conflict (email) do update set language = excluded.language, role = excluded.role`,
  );
}
