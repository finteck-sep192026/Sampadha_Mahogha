// Creates the 18 fictional demo accounts in Supabase Auth with RANDOM passwords, then loads their
// profiles, subscriptions, payments and notifications.
//
//   1. Copy .env.example to .env and paste your Supabase *secret* key.
//   2. npm run seed:demo
//
// Passwords are generated here, written only to demo-credentials.local.txt (git-ignored) and never
// stored anywhere else. Re-running skips accounts that already exist; add --reset-passwords to
// issue new passwords for them. Run this against a demo project only.
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env (see .env.example).');
  process.exit(1);
}
const resetPasswords = process.argv.includes('--reset-passwords');
const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const accounts = JSON.parse(readFileSync(new URL('./demo-accounts.json', import.meta.url), 'utf8'));

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const pick = (chars) => chars[randomInt(chars.length)];
function newPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*-_'];
  const all = sets.join('');
  const chars = [...sets.map(pick), ...Array.from({ length: 16 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ── auth users + profiles ──
const existing = new Map();
for (let page = 1; ; page++) {
  const { users } = must(await admin.auth.admin.listUsers({ page, perPage: 200 }), 'listUsers');
  users.forEach((u) => existing.set(u.email.toLowerCase(), u));
  if (users.length < 200) break;
}
const issued = [];
const profileIds = new Map(); // loginId -> uuid
for (const a of accounts) {
  let user = existing.get(a.email.toLowerCase());
  let password = null;
  if (!user) {
    password = newPassword();
    user = must(
      await admin.auth.admin.createUser({
        email: a.email,
        password,
        email_confirm: true,
        app_metadata: { role: a.role },
      }),
      `createUser ${a.email}`,
    ).user;
  } else if (resetPasswords) {
    password = newPassword();
    must(await admin.auth.admin.updateUserById(user.id, { password }), `reset ${a.email}`);
  }
  profileIds.set(a.loginId, user.id);
  if (password) issued.push({ ...a, password });
  must(
    await admin.from('profiles').upsert({
      id: user.id,
      login_id: a.loginId,
      role: a.role,
      full_name: a.fullName,
      initials: a.initials,
      email: a.email,
      mobile: a.mobile,
      pan: a.pan,
      risk_profile: a.risk,
      kyc_status: a.kyc,
    }),
    `profile ${a.loginId}`,
  );
}

// ── subscriptions, payments, notifications for clients ──
const TIERS = ['Nano', 'Micro', 'Mini', 'Mega', 'Giga'];
const PLAN_BY_CLIENT = {
  'CL-1001': 'Premium',
  'CL-1002': 'Growth',
  'CL-1003': 'Essential',
  'CL-1004': 'Premium',
  'CL-1005': 'Growth',
};
const PLAN_CYCLE = ['Essential', 'Growth', 'Premium'];
const PRODUCTS = {
  Essential: ['Cash'],
  Growth: ['Cash', 'Multi'],
  Premium: ['Cash', 'Multi', 'All'],
};
const ANNUAL = { Essential: 12000, Growth: 32000, Premium: 96000 };
const ALERTS = [
  [
    'Email',
    'Cash recommendation published',
    'TCS BUY view is now available in your Cash segment.',
    '2026-09-16T09:24:00+05:30',
    true,
  ],
  [
    'WhatsApp',
    'Multi portfolio update',
    'The Multi portfolio allocation has been refreshed.',
    '2026-09-15T16:40:00+05:30',
    true,
  ],
  [
    'In-app',
    'Quarterly review reminder',
    'Your advisor review is scheduled for 30 September.',
    '2026-09-15T11:05:00+05:30',
    true,
  ],
  [
    'Email',
    'Payment receipt available',
    'Your Jul–Sep quarterly payment receipt is ready.',
    '2026-09-14T14:18:00+05:30',
    false,
  ],
  [
    'WhatsApp',
    'Profile verification complete',
    'Your KYC and communication preferences are verified.',
    '2026-09-12T10:12:00+05:30',
    false,
  ],
];
const clients = accounts.filter((a) => a.role === 'client');
const subs = [],
  payments = [],
  alerts = [];
clients.forEach((c, i) => {
  const id = profileIds.get(c.loginId),
    n = c.loginId.replace(/\D/g, ''),
    plan = PLAN_BY_CLIENT[c.loginId] || PLAN_CYCLE[i % 3],
    quarter = ANNUAL[plan] / 4;
  subs.push({
    client_id: id,
    plan_code: plan,
    products: PRODUCTS[plan],
    multi_tier: TIERS[i % TIERS.length],
    billing: 'Quarterly',
    starts_on: '2026-04-01',
    ends_on: '2027-03-31',
    status: 'Active',
  });
  payments.push(
    {
      invoice_no: `INV-${n}-Q1`,
      client_id: id,
      plan_code: plan,
      period_label: 'Apr–Jun 2026',
      billing: 'Quarterly',
      amount: quarter,
      paid_on: '2026-04-01',
      status: 'Paid',
    },
    {
      invoice_no: `INV-${n}-Q2`,
      client_id: id,
      plan_code: plan,
      period_label: 'Jul–Sep 2026',
      billing: 'Quarterly',
      amount: quarter,
      paid_on: '2026-07-01',
      status: 'Paid',
    },
    {
      invoice_no: `INV-${n}-Q3`,
      client_id: id,
      plan_code: plan,
      period_label: 'Oct–Dec 2026',
      billing: 'Quarterly',
      amount: quarter,
      due_on: '2026-10-01',
      status: 'Upcoming',
    },
    {
      invoice_no: `INV-${n}-AN`,
      client_id: id,
      plan_code: plan,
      period_label: 'FY 2026–27',
      billing: 'Annual option',
      amount: ANNUAL[plan],
      status: 'Upcoming',
    },
  );
  ALERTS.forEach(([channel, title, detail, created_at, unread], k) =>
    alerts.push({
      alert_ref: `ALT-${n}-${k + 1}`,
      client_id: id,
      channel,
      title,
      detail,
      created_at,
      unread,
    }),
  );
});
// Subscription rows have no natural key; replace the demo clients' rows so re-runs don't duplicate.
const clientIds = clients.map((c) => profileIds.get(c.loginId));
must(await admin.from('subscriptions').delete().in('client_id', clientIds), 'clear subscriptions');
must(await admin.from('subscriptions').insert(subs), 'subscriptions');
must(await admin.from('payments').upsert(payments, { onConflict: 'invoice_no' }), 'payments');
must(
  await admin.from('client_notifications').upsert(alerts, { onConflict: 'alert_ref' }),
  'notifications',
);

// ── one pending application so the Admin approval queue is not empty ──
const sales = profileIds.get('SAL-011');
must(
  await admin.from('client_applications').upsert(
    {
      app_ref: 'APP-26091',
      submitted_by: sales,
      full_name: 'Ritesh Malhotra',
      pan: 'FGHPM4821K',
      email: 'ritesh@demo.in',
      mobile: '+91 98200 44219',
      broker: 'Zerodha',
      demat_id: '12081600-00984217',
      segments: ['Cash', 'F&O'],
      products: ['Cash'],
      risk_profile: 'Growth',
      proposed_amount: 1200000,
      consent: true,
      status: 'Pending',
      submitted_at: '2026-09-09T10:18:00+05:30',
    },
    { onConflict: 'app_ref' },
  ),
  'application',
);
must(
  await admin.from('email_log').upsert(
    {
      mail_ref: 'MAIL-26091',
      application_ref: 'APP-26091',
      recipient_email: 'ritesh@demo.in',
      recipient_name: 'Ritesh Malhotra',
      subject: 'We received your Sampadha client application',
      mail_type: 'Submission confirmation',
      body: 'Your client onboarding application APP-26091 has been received and is pending Admin review. We will notify you after a decision.',
      created_by: sales,
      sent_at: '2026-09-09T10:18:04+05:30',
    },
    { onConflict: 'mail_ref' },
  ),
  'email',
);

// ── credentials file ──
if (issued.length) {
  const lines = [
    'Sampadha demo credentials — generated ' + new Date().toISOString(),
    'Keep this file private. It is git-ignored. Sign in with the ID or the email.',
    '',
    ...issued.map(
      (u) => `${u.role.padEnd(6)} ${u.loginId.padEnd(8)} ${u.email.padEnd(32)} ${u.password}`,
    ),
    '',
  ];
  writeFileSync('demo-credentials.local.txt', lines.join('\n'));
  console.log(`Created/updated ${issued.length} passwords -> demo-credentials.local.txt`);
} else {
  console.log(
    'All accounts already existed; passwords unchanged (use --reset-passwords to rotate).',
  );
}
console.log(
  `Seeded ${accounts.length} profiles, ${subs.length} subscriptions, ${payments.length} payments, ${alerts.length} notifications.`,
);
