import { migrateTestDatabase, TEST_DATABASE_URL } from "../src/adapters/test-database.js";

/** Creates the e2e database if it is absent and applies its migrations, once per run. */
export default async function globalSetup(): Promise<void> {
  await migrateTestDatabase(TEST_DATABASE_URL, "e2e");
}
