-- 20261031224323_sign_in_links.sql — sign_in_links
-- Applied in filename order by db/migrate.ts (DEC-013).

-- The single-use sign-in link a locked-out member is emailed (issue 22). It rides on the member's
-- sign_in_codes row, so the sign-in email wait can read the code and the link in one statement.
-- The three columns are set and cleared together; link_hash is unique, so a redeem finds one row.
alter table sign_in_codes
  add column link_hash text,
  add column link_created_at timestamptz,
  add column link_expires_at timestamptz,
  add constraint sign_in_codes_link_together check (
    (link_hash is null) = (link_created_at is null) and (link_hash is null) = (link_expires_at is null)
  );

create unique index sign_in_codes_link_hash_key on sign_in_codes (link_hash) where link_hash is not null;
