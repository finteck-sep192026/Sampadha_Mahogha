# Sampadha Wealth Portal v2

Four-role portal (Admin, Research Analyst, Sales, Client) built from the `samapadha-mahoga2` prototype and
connected to Supabase. v1 (`../Sampadha-mah`) keeps running unchanged; both apps use the same Supabase
project but **separate tables**: v1 uses schema `public`, v2 uses schema `v2`.

## What is real here

| Area | How it works |
|---|---|
| Sign-in | Supabase Auth. The same demo logins as v1 work; access in v2 is decided by `v2.profiles`. |
| Data | Read through RLS on `v2.*` tables; every write is a `SECURITY DEFINER` function in schema `v2`. |
| Report attachments | Storage bucket `v2-research` (private), max 3 files per report, 5 MB each, image or PDF. |
| Report signing | **Digio Aadhaar eSign.** The PDF is sent to Digio by the `digio-esign` Edge Function, the analyst signs with an Aadhaar OTP in Digio's window, and the server confirms with Digio and stores the signed PDF. The browser cannot mark a report signed. |
| Delivery | `send_research_report` refuses reports without a confirmed eSign. Clients download the Digio-signed PDF. |
| Positions | One position per leg. Exits are recorded by lots; every exit is kept in `v2.research_leg_exits`. |

## Setup (once)

1. **Schema** — run `supabase/migrations/20261024000000_v2_schema.sql`, then `supabase/seed_v2.sql`, in the
   Supabase SQL editor.
2. **Expose the schema** — Dashboard → Project Settings → Data API → *Exposed schemas* → add `v2`.
3. **Edge Function** — `npx supabase login`, then `npm run deploy:esign`.
4. **Digio secrets** — Dashboard → Edge Functions → Secrets: `DIGIO_CLIENT_ID`, `DIGIO_CLIENT_SECRET`,
   `DIGIO_ENV` (`sandbox` until you go live, then `production`).
5. **Run** — `npm run serve:v2`, open <http://localhost:8766>.

## Signing a report

Research Analyst → Multiple reports → fill the legs, attachments and four analysis sections → *Create &
preview* → review the PDF → tick the confirmation, enter the email or mobile number registered with
Digio → *Sign with Aadhaar eSign*. After Digio confirms, choose product types and clients and send.
If the Digio window is closed early, use *Check signing status*.

## Files

```
api.js               the only file that talks to Supabase (schema v2, storage, Edge Function)
config.js            public project URL + publishable key
role-app.js          screens, navigation, sign-in/session
research-reports.js  reports, attachments, PDF, Digio eSign, delivery, positions
vendor/supabase.js   supabase-js browser build
```
