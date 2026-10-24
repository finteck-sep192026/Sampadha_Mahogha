-- Sampadha v2 demo data. Fictional. Run after 20261024000000_v2_schema.sql, in the SQL editor.
-- Links v2 profiles to the demo logins that already exist in auth.users (created for v1 by
-- scripts/seed-demo.mjs), so the same ID/email and password work in both apps. Accounts missing
-- from auth.users are skipped; run 'npm run seed:demo' first if none exist. Safe to re-run.

insert into v2.plans (code, name, price_annual, summary, sort_order) values
  ('Essential', 'Essential', 12000, 'Quarterly research updates', 1),
  ('Growth', 'Growth', 32000, 'Cash + Multi strategies', 2),
  ('Premium', 'Premium', 96000, 'All products and priority reviews', 3)
on conflict (code) do nothing;

insert into v2.strategies (name, universe, risk, analyst_name, status, updated_at) values
  ('Momentum Select', 'Large & Mid Cap', 'High', 'Rahul Arora', 'Published', '2026-09-09 09:18+05:30'),
  ('Quality Compounders', 'Large Cap', 'Moderate', 'Neha Singh', 'Published', '2026-09-08 15:42+05:30'),
  ('India Value 20', 'All Cap', 'Moderate–High', 'Rahul Arora', 'Draft', '2026-09-07 11:08+05:30'),
  ('Stable Income', 'Debt + Equity', 'Low–Moderate', 'Aman Jain', 'Review', '2026-09-05 16:21+05:30')
on conflict (name) do nothing;

insert into v2.cash_recommendations (ref, product, stock, price, qty, published_at, delivered_at, status) values
  ('CASH-26041', 'LC', 'TCS', 3412, 20, '2026-08-12 09:24+05:30', '2026-08-12 09:26+05:30', 'Active'),
  ('CASH-26052', 'MC', 'KOTAK', 1942, 35, '2026-08-18 11:06+05:30', '2026-08-18 11:08+05:30', 'Active'),
  ('CASH-26063', 'LC', 'INFY', 1528, 40, '2026-08-22 10:18+05:30', '2026-08-22 10:20+05:30', 'Active'),
  ('CASH-26071', 'SC', 'HERO', 5224, 10, '2026-09-03 15:11+05:30', '2026-09-03 15:14+05:30', 'Closed'),
  ('CASH-26082', 'All', 'SBI', 812, 75, '2026-09-08 10:02+05:30', '2026-09-08 10:04+05:30', 'Active')
on conflict (ref) do nothing;

insert into v2.multi_recommendations
  (ref, product, symbol, expiry, strike, option_type, side, lots, lot_size, price, published_at, delivered_at, status) values
  ('MULTI-26101', 'Nano', 'NIFTY', '2026-09-24', 25200, 'CE', 'BUY', 1, 75, 186.40, '2026-09-10 09:35+05:30', '2026-09-10 09:36+05:30', 'Active'),
  ('MULTI-26108', 'Mini', 'SENSEX', '2026-09-25', 82000, 'PE', 'BUY', 2, 20, 428.15, '2026-09-11 10:12+05:30', '2026-09-11 10:14+05:30', 'Active'),
  ('MULTI-26114', 'Micro', 'NIFTY', '2026-10-01', 25500, 'CE', 'SELL', 3, 75, 122.60, '2026-09-12 13:05+05:30', '2026-09-12 13:07+05:30', 'Review'),
  ('MULTI-26119', 'Mega', 'SENSEX', '2026-10-29', 83000, 'CE', 'BUY', 4, 20, 562.00, '2026-09-14 11:28+05:30', '2026-09-14 11:30+05:30', 'Active'),
  ('MULTI-26127', 'Giga', 'NIFTY', '2026-10-29', 25000, 'PE', 'SELL', 6, 75, 214.75, '2026-09-16 14:42+05:30', '2026-09-16 14:44+05:30', 'Active')
on conflict (ref) do nothing;

insert into v2.profiles (id, login_id, role, full_name, initials, email, mobile, pan, risk_profile, kyc_status)
select u.id, a.login_id, a.role::v2.app_role, a.full_name, a.initials, a.email, a.mobile, a.pan, a.risk, a.kyc
from (values
  ('admin@sampadha.demo', 'ADM-001', 'admin', 'Aditi Menon', 'AM', '+91 98200 11001', null, null, 'Internal account'),
  ('ra@sampadha.demo', 'RA-024', 'ra', 'Rahul Arora', 'RA', '+91 98200 11024', null, null, 'Internal account'),
  ('sales@sampadha.demo', 'SAL-011', 'sales', 'Sneha Kapoor', 'SK', '+91 98765 41011', null, null, 'Employee verified'),
  ('arjun.sales@sampadha.demo', 'SAL-018', 'sales', 'Arjun Mehta', 'AM', '+91 98765 41018', null, null, 'Employee verified'),
  ('nisha.sales@sampadha.demo', 'SAL-026', 'sales', 'Nisha Rao', 'NR', '+91 98765 41026', null, null, 'Employee verified'),
  ('client@sampadha.demo', 'CL-1001', 'client', 'Priya Sharma', 'PS', '+91 98765 43210', 'ABCDE1234F', 'Moderate Growth', 'Verified • 12 Jul 2026'),
  ('arun.client@sampadha.demo', 'CL-1002', 'client', 'Arun Nair', 'AN', '+91 98765 43211', 'BCDEF2345G', 'Growth', 'Verified • 18 Jul 2026'),
  ('meera.client@sampadha.demo', 'CL-1003', 'client', 'Meera Shah', 'MS', '+91 98765 43212', 'CDEFG3456H', 'Conservative', 'Verified • 23 Jul 2026'),
  ('vikram.client@sampadha.demo', 'CL-1004', 'client', 'Vikram Reddy', 'VR', '+91 98765 43213', 'DEFGH4567J', 'Aggressive', 'Verified • 02 Aug 2026'),
  ('kavya.client@sampadha.demo', 'CL-1005', 'client', 'Kavya Iyer', 'KI', '+91 98765 43214', 'EFGHJ5678K', 'Moderate', 'Verified • 09 Aug 2026'),
  ('rohan.client@sampadha.demo', 'CL-1006', 'client', 'Rohan Desai', 'RD', '+91 98765 43215', 'FGHJK6789L', 'Growth', 'Verified • 12 Aug 2026'),
  ('ananya.client@sampadha.demo', 'CL-1007', 'client', 'Ananya Gupta', 'AG', '+91 98765 43216', 'GHJKL7890M', 'Moderate', 'Verified • 15 Aug 2026'),
  ('suresh.client@sampadha.demo', 'CL-1008', 'client', 'Suresh Patel', 'SP', '+91 98765 43217', 'HJKLM8901N', 'Conservative', 'Verified • 18 Aug 2026'),
  ('divya.client@sampadha.demo', 'CL-1009', 'client', 'Divya Menon', 'DM', '+91 98765 43218', 'JKLMN9012P', 'Growth', 'Verified • 21 Aug 2026'),
  ('karan.client@sampadha.demo', 'CL-1010', 'client', 'Karan Malhotra', 'KM', '+91 98765 43219', 'KLMNP0123Q', 'Aggressive', 'Verified • 24 Aug 2026'),
  ('pooja.client@sampadha.demo', 'CL-1011', 'client', 'Pooja Joshi', 'PJ', '+91 98765 43220', 'LMNPQ1234R', 'Moderate', 'Verified • 27 Aug 2026'),
  ('nikhil.client@sampadha.demo', 'CL-1012', 'client', 'Nikhil Verma', 'NV', '+91 98765 43221', 'MNPQR2345S', 'Growth', 'Verified • 30 Aug 2026'),
  ('shreya.client@sampadha.demo', 'CL-1013', 'client', 'Shreya Rao', 'SR', '+91 98765 43222', 'NPQRS3456T', 'Conservative', 'Verified • 02 Sep 2026')
) as a (email, login_id, role, full_name, initials, mobile, pan, risk, kyc)
join auth.users u on lower(u.email) = lower(a.email)
on conflict (id) do update set login_id = excluded.login_id, role = excluded.role,
  full_name = excluded.full_name, initials = excluded.initials, mobile = excluded.mobile,
  pan = excluded.pan, risk_profile = excluded.risk_profile, kyc_status = excluded.kyc_status;

-- Subscriptions (Multi tier decides which clients an analyst can send a report to).
delete from v2.subscriptions where client_id in (select id from v2.profiles where role = 'client');
insert into v2.subscriptions (client_id, plan_code, products, multi_tier, billing, starts_on, ends_on, status)
select p.id, s.plan, case s.plan when 'Essential' then '{Cash}'::text[] when 'Growth' then '{Cash,Multi}'
                                 else '{Cash,Multi,All}' end,
       s.tier, 'Quarterly', '2026-04-01', '2027-03-31', 'Active'
from (values
  ('CL-1001', 'Premium', 'Nano'),
  ('CL-1002', 'Growth', 'Micro'),
  ('CL-1003', 'Essential', 'Mini'),
  ('CL-1004', 'Premium', 'Mega'),
  ('CL-1005', 'Growth', 'Giga'),
  ('CL-1006', 'Premium', 'Nano'),
  ('CL-1007', 'Essential', 'Micro'),
  ('CL-1008', 'Growth', 'Mini'),
  ('CL-1009', 'Premium', 'Mega'),
  ('CL-1010', 'Essential', 'Giga'),
  ('CL-1011', 'Growth', 'Nano'),
  ('CL-1012', 'Premium', 'Micro'),
  ('CL-1013', 'Essential', 'Mini')
) as s (login_id, plan, tier)
join v2.profiles p on p.login_id = s.login_id;

insert into v2.payments (invoice_no, client_id, plan_code, period_label, billing, amount, paid_on, due_on, status)
select 'INV-' || regexp_replace(p.login_id, '\D', '', 'g') || '-' || x.suffix, p.id, s.plan_code, x.period,
       x.billing, pl.price_annual * x.share, x.paid_on, x.due_on, x.status
from v2.profiles p
join v2.subscriptions s on s.client_id = p.id
join v2.plans pl on pl.code = s.plan_code
cross join (values
  ('Q1', 'Apr–Jun 2026', 'Quarterly', 0.25, date '2026-04-01', null::date, 'Paid'),
  ('Q2', 'Jul–Sep 2026', 'Quarterly', 0.25, date '2026-07-01', null, 'Paid'),
  ('Q3', 'Oct–Dec 2026', 'Quarterly', 0.25, null, date '2026-10-01', 'Upcoming'),
  ('AN', 'FY 2026–27', 'Annual option', 1, null, null, 'Upcoming')
) as x (suffix, period, billing, share, paid_on, due_on, status)
on conflict (invoice_no) do nothing;

insert into v2.client_notifications (alert_ref, client_id, channel, title, detail, created_at, unread)
select 'ALT-' || regexp_replace(p.login_id, '\D', '', 'g') || '-' || x.k, p.id, x.channel, x.title, x.detail,
       x.created_at, x.unread
from v2.profiles p
cross join (values
  (1, 'Email', 'Cash recommendation published', 'TCS BUY view is now available in your Cash segment.', timestamptz '2026-09-16 09:24+05:30', true),
  (2, 'WhatsApp', 'Multi portfolio update', 'The Multi portfolio allocation has been refreshed.', '2026-09-15 16:40+05:30', true),
  (3, 'In-app', 'Quarterly review reminder', 'Your advisor review is scheduled for 30 September.', '2026-09-15 11:05+05:30', true),
  (4, 'Email', 'Payment receipt available', 'Your Jul–Sep quarterly payment receipt is ready.', '2026-09-14 14:18+05:30', false),
  (5, 'WhatsApp', 'Profile verification complete', 'Your KYC and communication preferences are verified.', '2026-09-12 10:12+05:30', false)
) as x (k, channel, title, detail, created_at, unread)
where p.role = 'client'
on conflict (alert_ref) do nothing;

-- One pending application so the Admin approval queue is not empty.
insert into v2.client_applications (app_ref, submitted_by, full_name, pan, email, mobile, broker, demat_id,
                                    segments, products, risk_profile, proposed_amount, consent, status, submitted_at)
select 'APP-27091', p.id, 'Ritesh Malhotra', 'FGHPM4821K', 'ritesh@demo.in', '+91 98200 44219', 'Zerodha',
       '12081600-00984217', '{Cash,F&O}', '{Cash}', 'Growth', 1200000, true, 'Pending', '2026-09-09 10:18+05:30'
from v2.profiles p where p.login_id = 'SAL-011'
on conflict (app_ref) do nothing;
insert into v2.email_log (mail_ref, application_ref, recipient_email, recipient_name, subject, mail_type, body,
                          created_by, sent_at)
select 'MAIL-27091', 'APP-27091', 'ritesh@demo.in', 'Ritesh Malhotra', 'We received your Sampadha client application',
       'Submission confirmation',
       'Your client onboarding application APP-27091 has been received and is pending Admin review. We will notify you after a decision.',
       p.id, '2026-09-09 10:18:04+05:30'
from v2.profiles p where p.login_id = 'SAL-011'
on conflict (mail_ref) do nothing;

select role, count(*) from v2.profiles group by role order by role;
