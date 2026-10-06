-- Sampadha demo reference data. Fictional. Run once after the migration.
-- Per-user demo data (accounts, subscriptions, payments, notifications) is created by
-- scripts/seed-demo.mjs because it needs auth users.

insert into public.plans (code, name, price_annual, summary, sort_order) values
  ('Essential', 'Essential', 12000, 'Quarterly research updates', 1),
  ('Growth', 'Growth', 32000, 'Cash + Multi strategies', 2),
  ('Premium', 'Premium', 96000, 'All products and priority reviews', 3)
on conflict (code) do nothing;

insert into public.strategies (name, universe, risk, analyst_name, status, updated_at) values
  ('Momentum Select', 'Large & Mid Cap', 'High', 'Rahul Arora', 'Published', '2026-09-09 09:18+05:30'),
  ('Quality Compounders', 'Large Cap', 'Moderate', 'Neha Singh', 'Published', '2026-09-08 15:42+05:30'),
  ('India Value 20', 'All Cap', 'Moderate–High', 'Rahul Arora', 'Draft', '2026-09-07 11:08+05:30'),
  ('Stable Income', 'Debt + Equity', 'Low–Moderate', 'Aman Jain', 'Review', '2026-09-05 16:21+05:30')
on conflict (name) do nothing;

insert into public.cash_recommendations (ref, product, stock, price, qty, published_at, delivered_at, status) values
  ('CASH-26041', 'LC', 'TCS', 3412, 20, '2026-08-12 09:24+05:30', '2026-08-12 09:26+05:30', 'Active'),
  ('CASH-26052', 'MC', 'KOTAK', 1942, 35, '2026-08-18 11:06+05:30', '2026-08-18 11:08+05:30', 'Active'),
  ('CASH-26063', 'LC', 'INFY', 1528, 40, '2026-08-22 10:18+05:30', '2026-08-22 10:20+05:30', 'Active'),
  ('CASH-26071', 'SC', 'HERO', 5224, 10, '2026-09-03 15:11+05:30', '2026-09-03 15:14+05:30', 'Closed'),
  ('CASH-26082', 'All', 'SBI', 812, 75, '2026-09-08 10:02+05:30', '2026-09-08 10:04+05:30', 'Active')
on conflict (ref) do nothing;

insert into public.multi_recommendations
  (ref, product, symbol, expiry, strike, option_type, side, lots, lot_size, price, published_at, delivered_at, status) values
  ('MULTI-26101', 'Nano', 'NIFTY', '2026-09-24', 25200, 'CE', 'BUY', 1, 75, 186.40, '2026-09-10 09:35+05:30', '2026-09-10 09:36+05:30', 'Active'),
  ('MULTI-26108', 'Mini', 'SENSEX', '2026-09-25', 82000, 'PE', 'BUY', 2, 20, 428.15, '2026-09-11 10:12+05:30', '2026-09-11 10:14+05:30', 'Active'),
  ('MULTI-26114', 'Micro', 'NIFTY', '2026-10-01', 25500, 'CE', 'SELL', 3, 75, 122.60, '2026-09-12 13:05+05:30', '2026-09-12 13:07+05:30', 'Review'),
  ('MULTI-26119', 'Mega', 'SENSEX', '2026-10-29', 83000, 'CE', 'BUY', 4, 20, 562.00, '2026-09-14 11:28+05:30', '2026-09-14 11:30+05:30', 'Active'),
  ('MULTI-26127', 'Giga', 'NIFTY', '2026-10-29', 25000, 'PE', 'SELL', 6, 75, 214.75, '2026-09-16 14:42+05:30', '2026-09-16 14:44+05:30', 'Active')
on conflict (ref) do nothing;
