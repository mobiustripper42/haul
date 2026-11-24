-- 20261124042747_ledger_charge_source.sql — ledger_charge_source
-- Applied in filename order by db/migrate.ts (DEC-013).

-- Issue 254 (DEC-053): a member-present charge goes to the card token first, and the card is saved from the payment. The
-- token lives on the ledger row while its charge is out, a signup's pending row or a card update's declined one (which
-- stays declined), and that column is what "charge out" means: the spot count, the refusal of a second save, Try again and
-- the charge run's look-but-don't-charge rule all read it. Null once the row settles or its token is abandoned. The card on
-- file stays in subscriptions.square_card_id. `ledger` already carries the audit trigger, so audit_log keeps a copy of the
-- token: single-use, short-lived, and no use without the farm's Square secret.
alter table ledger add column charge_source nonblank_text;
