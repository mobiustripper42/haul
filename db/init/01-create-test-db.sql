-- Runs once, on the container's first init (docker-entrypoint-initdb.d). Creates the test database
-- beside haul_dev, so the suites have one to wipe without touching dev data. Migrations run
-- separately, through db/migrate.ts.
CREATE DATABASE haul_test OWNER haul;
