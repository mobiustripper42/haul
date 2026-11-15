-- 20261115140032_subscription_card_details.sql — subscription_card_details
-- Applied in filename order by db/migrate.ts (DEC-013).


-- Issue 145: the subscription remembers its card's brand and last four, written when the card is bound or replaced, so
-- "On file now" renders without a Square read on every page view. Nullable: a card bound before this has none, and the
-- page skips the line for it. The card's id stays in square_card_id.
alter table subscriptions
  add column card_brand nonblank_text,
  add column card_last4 nonblank_text;
