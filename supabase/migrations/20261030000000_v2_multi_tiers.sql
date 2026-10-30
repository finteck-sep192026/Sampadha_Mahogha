-- Multi products (tiers) renamed, five to six, lowest to highest:
--   Bronze, Silver, Palladium, Platinum, Gold, Rhodium   (were Nano, Micro, Mini, Mega, Giga)
-- Subscriptions move to the tier in the same position; Rhodium is new. Report legs keep the
-- product name they were signed with (their check is only a length check since 20261025000000). The early sample table
-- v2.multi_recommendations is no longer read and is left as it is.

alter table v2.subscriptions drop constraint if exists subscriptions_multi_tier_check;
update v2.subscriptions
   set multi_tier = case multi_tier
     when 'Nano' then 'Bronze'
     when 'Micro' then 'Silver'
     when 'Mini' then 'Palladium'
     when 'Mega' then 'Platinum'
     when 'Giga' then 'Gold'
     else multi_tier end
 where multi_tier in ('Nano', 'Micro', 'Mini', 'Mega', 'Giga');
alter table v2.subscriptions add constraint subscriptions_multi_tier_check
  check (multi_tier in ('Bronze', 'Silver', 'Palladium', 'Platinum', 'Gold', 'Rhodium'));

