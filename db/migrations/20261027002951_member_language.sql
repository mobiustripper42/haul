-- 20261027002951_member_language.sql — member_language
-- Applied in filename order by db/migrate.ts (DEC-013).


-- The language a member reads the app in. The check refuses any value the code would mistake for a
-- supported language; adding a language later is a one-line migration that widens it.
alter table members
  add column language text not null default 'en' check (language in ('en', 'es'));
