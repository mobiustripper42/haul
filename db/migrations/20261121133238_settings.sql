-- 20261121133238_settings.sql — settings
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The farm's tunable numbers (issue 231; DEC-049): one row per setting, its value text that the core parses
-- (`wholeNumberSetting`, src/settings.ts). Written by SQL and the seed only (DEC-007); the app reads. The app
-- role's default privileges (DEC-037) give haul_app its four rights.
create table settings (
  key text primary key,
  value text not null
);

create trigger audit after insert or update or delete on settings
  for each row execute function audit_row();
