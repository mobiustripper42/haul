-- 20261028120618_rate_limit_hits.sql — rate_limit_hits
-- Applied in filename order by db/migrate.ts (DEC-013).


-- One counter per (bucket, key, window). Every increment first deletes the rows whose expires_at
-- has passed, so the table holds only live windows; the index keeps that sweep cheap.
create table rate_limit_hits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  expires_at timestamptz not null,
  hits integer not null,
  primary key (bucket, key, window_start)
);

create index rate_limit_hits_expires_at on rate_limit_hits (expires_at);
