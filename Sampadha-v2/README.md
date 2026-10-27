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
| Multi Quick input | Instead of a CSV, the analyst can type a compact basket, one option leg per line: `CB Nifty 03Nov 24000C+3 @120-125 T180 SL95` (prefix CB/PB/BC/BP/RP/RC, symbol, expiry, strike + C/P, `+` buy / `-` sell with lots, `@` entry or entry range, `T` target, `SL` stop-loss). Lot size, exchange, contract name and instrument (NSE OPTIDX/OPTSTK, BSE IDO/STO) come from the latest weekly master. Each basket gets its own AdviceName (prefix + underlying + IST time stamp, e.g. `CALL BUY NIFTY 261027-1630`) so PaRRVA records it as new advice, not a change to an earlier one. The rows then go through the same CSV validation, preview, eSign and sending. |
| Weekly master | RA/Admin → Uploads: the weekly Multisegment master (CSV, XLS or XLSX, up to 10 MB; standard columns MainExch, SubExch, FinInstrmTp, TckrSymb, XpryDt, NewBrdLotQty, MOFSLExchCode, BajajExch, BajajInst, Symbol, or legacy Symbol + MLot). Stored privately at `v2-research/masters/<uuid>.<ext>` and listed in `v2.symbol_masters` via `register_symbol_master`; the newest upload is the one in use. |
| CARE PaRRVA | After the eSign, the analyst can send the report to CARE PaRRVA, to clients, or both (PaRRVA first; clients only if it is accepted). The `parrva` Edge Function builds the Strategy payload from the saved legs (rows sharing an AdviceName = one strategy), signs in with the PaRRVA token API and posts the JWE-encrypted payload (RSA-OAEP-256 + A256GCM, `parrva.pem` / `pdc_public_key.pem`) to the PDC Strategy API. Each attempt is kept in `v2.parrva_submissions`. |
| Cash Segment | LC/MC/SC reports, Monthly/Quarterly/Half-Yearly, from the 12-column CSV (`cash-strategy-template.csv`, up to 100 rows) via `create_cash_report_draft`. Stored in `v2.research_reports` (`segment = 'Cash'`) + `v2.cash_report_rows`, so they use the same eSign, storage and delivery. Sent with `send_cash_report` to clients whose plan includes Cash. The library shows the latest two real reports per strategy and period. |
| Broker auto-email | Mahogha's "Auto Email Execution", with the client's own consent. The client enters (or confirms what Sales/Admin entered) the broker, broker client ID, the broker's order email (TO) and CC copies, and ticks the consent (wording `BAE-2026-10-27`, recorded with time; withdrawable any time) on *Broker auto-email*. Whenever a signed Multi or Cash report is delivered to that client, a trigger on `v2.research_deliveries` queues an order email to the broker built from the legs (contract, BUY/SELL, lots × lot size, entry range, target, stop-loss) or the Cash BUY/SELL rows. The RA's send screens tag these clients with ⇄. Every consent change is in the audit trail. |
| Compliance | Like Mahogha's RA / Contract / KYC columns and E-Sign page. **Client → Compliance**: a 9-question risk profile (`RP-2026-10-27`; scored in the database into Conservative / Moderate / Growth / Aggressive, plus whether F&O research can suit them; every submission kept) and documents to sign with Aadhaar eSign. **Admin / Sales → Compliance**: per-client overview (risk profile, agreement signed, KYC, broker auto-email), *Send a document for e-sign* (any PDF up to 10 MB, all pages or last page signed; the client is notified and emailed), download original and signed copies; Admin records KYC. The `client-esign` Edge Function alone marks a document signed. The RA's send screens warn when a client has no risk profile, no signed agreement, or a profile that F&O may not suit. |
| Email | All portal emails (application, approval, report notices, broker orders, test emails) are queued in `v2.email_log` and sent by the `mailer` Edge Function over SMTP right after the action. Until the SMTP secrets are set they are marked *Simulated* (logged only, never sent later). Broker orders more than 30 minutes old are marked *Expired*, never sent late. Admin → *Email delivery* shows whether sending is on and has *Send test email*. Live since 27 Oct 2026 through the Hostinger mailbox research@fintecindia.com. |
| Positions | One position per Multi CSV row. Exits are recorded by lots; every exit is kept in `v2.research_leg_exits`. |
| Overviews | Built from the database: Admin sees active clients, reports delivered, the signing pipeline, compliance meters, a monthly *Reports delivered* chart and the latest audit entries; the Research Analyst sees their figures and a monthly *Your reports* chart; clients see their alerts, reports and checklist. Every chart has a hover tooltip and a *Show table* view. |

## Setup (once)

1. **Schema** — run `supabase/migrations/20261024000000_v2_schema.sql`, then
   `20261025000000_v2_csv_legs_and_cash.sql`, `20261025010000_v2_parrva.sql`,
   `20261027000000_v2_symbol_master.sql`, `20261027020000_v2_broker_email.sql`,
   `20261027030000_v2_client_compliance.sql`, `20261027040000_v2_mail_test.sql`, then `supabase/seed_v2.sql`, in
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
   NSE PDC only answers whitelisted IP addresses and Supabase has no fixed outgoing IP, so the Strategy
   call goes through the relay on this site (`relay/v1/index.php`, PHP on Hostinger) once the secret
   `PDC_RELAY_KEY` is set (its value is in the git-ignored `.env`; the relay keeps only its SHA-256).
   The relay forwards to the one PDC URL only: `GET /relay/v1/health`, `GET /relay/v1/egress-ip` (the IP
   to whitelist at NSE) and `POST /relay/v1/pdc/strategies` (header `X-Relay-Key`, PaRRVA token in
   `X-PDC-Authorization`), max 30 calls a minute; its own errors carry `X-Relay-Error`. To change the
   key, put a new SHA-256 in `RELAY_KEY_SHA256` and the new value in the secret.
6. **Email** — deploy `supabase/functions/mailer/index.ts` as `mailer`, then add secrets `SMTP_HOST`
   (e.g. `smtp.hostinger.com`), `SMTP_USERNAME`, `SMTP_PASSWORD`, and optional `SMTP_PORT` (default 465;
   Supabase blocks 25 and 587), `MAIL_FROM` (e.g. `Sampadha Research <research@sampadha.com>`) and
   `MAIL_REPLY_TO`. Admin → *Broker auto-email* shows whether sending is on.
7. **Client eSign** — deploy `supabase/functions/client-esign/index.ts` as `client-esign` (uses the same
   `FINANALYZ_API_KEY` as `esign`).
8. **Run** — `npm run serve:v2`, open <http://localhost:8766>.

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
multi-quick-input.js Multi Segment Quick input (compact basket) and the Uploads page for the weekly master
design-system.css    loaded last: tokens, type (Newsreader + Mona Sans), shell, components, motion (see its header)
icons.js             SVG line icons for navigation and the top bar
charts.js            chart card + Chart.js column chart (tooltip, legend, table view) and meters
overview.js          Admin / Research Analyst / Client overviews built from real data
client-compliance.js Compliance pages (risk profile, documents for Aadhaar eSign, KYC)
broker-email.js      Broker auto-email pages (client consent, Sales/Admin set-up)
relay/v1/index.php   fixed-IP relay for the NSE PDC Strategy API (PHP, runs on Hostinger)
vendor/supabase.js   supabase-js browser build
vendor/chart.umd.min.js  Chart.js 4 (MIT), loaded only when a chart is drawn
vendor/fonts/        Newsreader + Mona Sans variable fonts (OFL), self-hosted
vendor/xlsx.full.min.js  SheetJS 0.20.3 (Apache-2.0), loaded only when a weekly master is read
```
