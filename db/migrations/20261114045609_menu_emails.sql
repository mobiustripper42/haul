-- 20261114045609_menu_emails.sql — menu_emails
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Issue 141: the weekly menu email. A member's preference is a column on members, on for everyone already there; the
-- sign-in codes, receipts and card notices ignore it. The stamp that makes a week's menu email once is a column on the
-- week's menu row: null until the menu run sends it, and gone with the row when the menu is taken off the week, so a
-- menu put on later is sent again.
alter table members add column menu_emails boolean not null default true;
alter table week_menus add column sent_at timestamptz;
