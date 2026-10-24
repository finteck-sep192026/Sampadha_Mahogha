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
| Report signing | **Aadhaar eSign (NSDL) through the FinAnalyz gateway.** The `esign` Edge Function sends the PDF, the analyst signs with an Aadhaar OTP on the hosted eSign page and is sent back, and the server confirms with the gateway and stores the signed PDF. The browser cannot mark a report signed. |
| Delivery | `send_research_report` refuses reports without a confirmed eSign. Clients download the signed PDF. |
| Positions | One position per leg. Exits are recorded by lots; every exit is kept in `v2.research_leg_exits`. |

## Setup (once)

1. **Schema** — run `supabase/migrations/20261024000000_v2_schema.sql`, then `supabase/seed_v2.sql`, in the
   Supabase SQL editor.
2. **Expose the schema** — Dashboard → Project Settings → Data API → *Exposed schemas* → add `v2`.
3. **Edge Function** — `npx supabase login`, then `npm run deploy:esign` (or paste
   `supabase/functions/esign/index.ts` into Dashboard → Edge Functions → Deploy via Editor, name `esign`).
4. **eSign secret** — Dashboard → Edge Functions → Secrets: `FINANALYZ_API_KEY` (the XApiKey from
   console.finanalyz.com, with eSign enabled and production credits). Optional `ESIGN_RETURN_ORIGINS`:
   comma-separated HTTPS origins allowed to receive the signer back (default:
   https://racrm.fintecindia.com). The eSign service rejects non-HTTPS return addresses, so a local copy
   sends signers back to the live site (`liveSiteUrl` in `config.js`).
5. **Run** — `npm run serve:v2`, open <http://localhost:8766>.

## Live site

<https://racrm.fintecindia.com> (Hostinger) is deployed from the GitHub branch `deploy-v2`, which holds only
this folder. To release changes: commit on `main`, run `npm run publish:v2`, then press *Deploy* in
hPanel → racrm.fintecindia.com → Advanced → GIT if it does not redeploy on its own.

## Signing a report

Research Analyst → Multiple reports → fill the legs, attachments and four analysis sections → *Create &
preview* → review the PDF → tick the confirmation, enter your mobile number → *Sign with Aadhaar eSign*. The
NSDL eSign page opens; enter your Aadhaar number and the OTP, and you are brought back to the report,
where the signature is confirmed automatically. Then choose product types and clients and send. If you
come back another way, open the report and use *Check signing status*.

## Files

```
api.js               the only file that talks to Supabase (schema v2, storage, Edge Function)
config.js            public project URL + publishable key
role-app.js          screens, navigation, sign-in/session
research-reports.js  reports, attachments, PDF, Aadhaar eSign, delivery, positions
vendor/supabase.js   supabase-js browser build
```
