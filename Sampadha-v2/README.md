# Sampadha Wealth Portal v2

Four-role portal (Admin, Research Analyst, Sales, Client) built from the `samapadha-mahoga2` prototype
(updated with the 25 Oct 2026 `sampadha-mahg-oct-25 new` prototype) and connected to Supabase. v1 (`../Sampadha-mah`) keeps running unchanged; both apps use the same Supabase
project but **separate tables**: v1 uses schema `public`, v2 uses schema `v2`.

## What is real here

| Area | How it works |
|---|---|
| Sign-in | Supabase Auth. The same demo logins as v1 work; access in v2 is decided by `v2.profiles`. |
| Data | Read through RLS on `v2.*` tables; every write is a `SECURITY DEFINER` function in schema `v2`. |
| Report attachments | Storage bucket `v2-research` (private), max 3 files per report, 5 MB each, image or PDF. |
| Report signing | **Aadhaar eSign (NSDL) through the FinAnalyz gateway.** The `esign` Edge Function sends the PDF, the analyst signs with an Aadhaar OTP on the hosted eSign page and is sent back, and the server confirms with the gateway and stores the signed PDF. The browser cannot mark a report signed. |
| Delivery | `send_research_report` refuses reports without a confirmed eSign. Clients download the signed PDF. |
| Multi Segment | Legs come from the 19-column advice CSV (`multi-recommendations-template.csv`, up to 50 rows). Its columns are CARE PaRRVA's Strategy API fields, and both the browser and `create_research_draft` validate them with PaRRVA's rules (NSE/BSE instrument codes, PR/CMP/FP, CE/PE + strike for options only, BUY/SELL entry ranges, numeric LegId unique per AdviceName). |
| CARE PaRRVA | After the eSign, the analyst can send the report to CARE PaRRVA, to clients, or both (PaRRVA first; clients only if it is accepted). The `parrva` Edge Function builds the Strategy payload from the saved legs (rows sharing an AdviceName = one strategy), signs in with the PaRRVA token API and posts the JWE-encrypted payload (RSA-OAEP-256 + A256GCM, `parrva.pem` / `pdc_public_key.pem`) to the PDC Strategy API. Each attempt is kept in `v2.parrva_submissions`. |
| Cash Segment | LC/MC/SC reports, Monthly/Quarterly/Half-Yearly, from the 12-column CSV (`cash-strategy-template.csv`, up to 100 rows) via `create_cash_report_draft`. Stored in `v2.research_reports` (`segment = 'Cash'`) + `v2.cash_report_rows`, so they use the same eSign, storage and delivery. Sent with `send_cash_report` to clients whose plan includes Cash. The library shows the latest two real reports per strategy and period. |
| Positions | One position per Multi CSV row. Exits are recorded by lots; every exit is kept in `v2.research_leg_exits`. |
| RA Overview | Counts come from the database; the activity table lists this browser session's actions. |

## Setup (once)

1. **Schema** — run `supabase/migrations/20261024000000_v2_schema.sql`, then
   `20261025000000_v2_csv_legs_and_cash.sql`, `20261025010000_v2_parrva.sql`, then `supabase/seed_v2.sql`, in
   the Supabase SQL editor.
2. **Expose the schema** — Dashboard → Project Settings → Data API → *Exposed schemas* → add `v2`.
3. **Edge Function** — `npx supabase login`, then `npm run deploy:esign` (or paste
   `supabase/functions/esign/index.ts` into Dashboard → Edge Functions → Deploy via Editor, name `esign`).
4. **eSign secret** — Dashboard → Edge Functions → Secrets: `FINANALYZ_API_KEY` (the XApiKey from
   console.finanalyz.com, with eSign enabled and production credits). Optional `ESIGN_RETURN_ORIGINS`:
   comma-separated HTTPS origins allowed to receive the signer back (default:
   https://racrm.fintecindia.com). The eSign service rejects non-HTTPS return addresses, so a local copy
   sends signers back to the live site (`liveSiteUrl` in `config.js`).
5. **CARE PaRRVA** — `20261025010000_v2_parrva.sql`, deploy `supabase/functions/parrva/index.ts` as `parrva`, and add
   secrets `PARRVA_USERNAME` (Enrolment ID) and `PARRVA_PASSWORD`. Optional `PARRVA_AUTH_URL` /
   `PARRVA_STRATEGY_URL` override the endpoints from RA API document 0.0.3.
6. **Run** — `npm run serve:v2`, open <http://localhost:8766>.

## Live site

<https://racrm.fintecindia.com> (Hostinger) is deployed from the GitHub branch `deploy-v2`, which holds only
this folder. To release changes: commit on `main`, run `npm run publish:v2`, then press *Deploy* in
hPanel → racrm.fintecindia.com → Advanced → GIT if it does not redeploy on its own.

## Signing a report

Research Analyst → Multi Segment → upload the advice CSV, add attachments and the four analysis sections →
*Create & preview PDF* (or Cash Segment → *+ New Report* → product, frequency and CSV → *Create & Preview PDF*) → review the PDF → tick the confirmation, enter your mobile number → *Sign with Aadhaar eSign*. The
NSDL eSign page opens; enter your Aadhaar number and the OTP, and you are brought back to the report,
where the signature is confirmed automatically. Then send to CARE PaRRVA and/or clients. If you
come back another way, open the report and use *Check signing status*.

## Files

```
api.js               the only file that talks to Supabase (schema v2, storage, Edge Function)
config.js            public project URL + publishable key
role-app.js          screens, navigation, sign-in/session
research-reports.js  Multi Segment: CSV import, attachments, PDF, Aadhaar eSign, delivery, positions
cash-segment.js      Cash Segment: CSV import, report library, PDF, Aadhaar eSign, delivery, RA activity
vendor/supabase.js   supabase-js browser build
```
