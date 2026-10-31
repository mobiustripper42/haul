import { TEST_DATABASE_URL, testDatabaseUrl } from "../src/adapters/test-database.js";

/** The e2e database's URL: the test database's name with `_e2e`. */
export function e2eDatabaseUrl(base: string = TEST_DATABASE_URL): string {
  return testDatabaseUrl(base, "e2e");
}
