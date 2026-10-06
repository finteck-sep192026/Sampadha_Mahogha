# Sampadha Wealth Portal

Role-based wealth-advisory portal (Admin, Research Analyst, Sales, Client) with fictional data.
Static front end in [`Sampadha-mah/`](Sampadha-mah/) + a Supabase (PostgreSQL) back end defined in [`supabase/`](supabase/).

## How it is secured

| Concern | How it works |
|---|---|
| Sign-in | Supabase Auth checks the password on the server. No passwords exist in the repo or the browser code. Public sign-up is disabled; accounts are created by an admin. |
| Roles | A row in `profiles` (`admin` / `ra` / `sales` / `client`) decides access. No profile = no access. Hiding menu items is only cosmetic. |
| Reads | Row Level Security on every table. A client can only read their own data and the reports delivered to them; an analyst only their own reports; etc. |
| Writes | The Data API is **read-only**. Every change goes through a `SECURITY DEFINER` function that re-checks the caller's role and validates input (`submit_client_application`, `decide_client_application`, `create_research_draft`, `send_research_report`, `close_research_leg`, …). |
| Report signing | Sending a report needs a 6-digit authenticator-app code (TOTP). The auth server stamps the verified code into the user's token; `send_research_report` accepts it only if it was verified **after** the draft was created, within 5 minutes, and not used before. The browser cannot forge or replay it. Not an Aadhaar eSign. |
| Audit | `audit_log` is append-only (a trigger blocks update/delete) and readable by Admin only. |
| Keys | The browser uses the *publishable* key (safe by design). The *secret* key is only for `scripts/` on your machine and must never go in `Sampadha-mah/`. |

## Setup

1. **Database** — already provisioned in the Supabase project `Sampadha` (Mumbai, `ap-south-1`).
   To rebuild elsewhere, run `supabase/migrations/*.sql`, then `supabase/seed.sql`, in the SQL editor.
   Auth settings used: sign-ups off, minimum password length 12, TOTP MFA on.
2. **Secret key** — copy `.env.example` to `.env` and paste the secret key from
   *Supabase → Project Settings → API Keys → Secret keys*.
3. **Demo accounts** — `npm install`, then `npm run seed:demo`. It creates the 18 accounts with random
   passwords and writes them to `demo-credentials.local.txt` (git-ignored). Re-run with
   `-- --reset-passwords` to rotate them.
4. **Run the site** — `npm run serve`, then open <http://localhost:8765>.
5. **First report** — as the Research Analyst, create a report, then *Set up authenticator app*, scan the QR
   code, and enter the code. Next time you only enter a code.

## Repository layout

```
Sampadha-mah/        the website (HTML/CSS/JS, no build step)
  api.js             the only file that talks to Supabase
  config.js          public project URL + publishable key
  role-app.js        screens, navigation, sign-in/session
  research-reports.js  research reports, authenticator signing, orders, PDF
  vendor/supabase.js   supabase-js browser build (npm run vendor to refresh)
supabase/
  migrations/        schema, RLS, functions
  seed.sql           plans, strategies, sample recommendations
scripts/             seed-demo.mjs, demo-accounts.json, copy-vendor.mjs
```

## Known limits (next steps)

- **Email is simulated.** Mail records are stored with status `Simulated`; nothing is sent. Real email needs an
  SMTP/transactional provider and a verified sender domain.
- **Dashboard KPIs are illustrative** (static numbers); recommendations, clients, reports, orders, payments,
  notifications, strategies and the audit trail are live.
- **Approving a client** records the decision and email; it does not yet create their login.
- **PAN / personal data** is stored as plain columns. Before real clients, add field-level encryption, a data
  retention policy and Indian data-residency review (the project is already in Mumbai).
- **Passwords are the only first factor.** Consider enforcing MFA at sign-in for staff.
- **No rate limiting beyond Supabase defaults** on sign-in; `resolve_login` reveals whether an ID/email exists.
