# Broker orders sent from the client's own Gmail

When a signed report reaches a client who has consented, the order email goes to their broker's
dealing desk **from the client's own Gmail address**, through the Gmail API, using the client's
one-time Google approval. Scope is send-only (`gmail.send`): the portal can never read a mailbox.

Sampadha's own mailbox never sends a broker order. If Gmail cannot send it, the order fails and
people are told. There is no fallback.

## Rules that must not be broken

1. **Never fall back to SMTP** for `Broker order` or `Broker test` rows.
2. **Never forge a sender.** The From address is always the client's connected Gmail.
3. **Never send an order twice.** Retry only when Gmail answers HTTP 429, because then it definitely
   did not accept the mail. Any other failure, including HTTP 503 and every other 5xx, a timeout or a
   dropped connection, may have been delivered: mark `Failed` and alert, do not retry. Rows stuck in
   `Sending` are also marked `Failed` with an alert, never put back in the queue.
4. **Never send late.** A `Broker order` older than 30 minutes is `Expired` (with an alert).
5. **Consent is re-checked just before sending.** Consent must be `Active`, the Gmail link
   `Connected`, and the connected address must equal the client's portal email.
6. **Refresh tokens are encrypted** (AES-256-GCM) and never reach a browser or a log.

## Parts

| Part | Files |
|---|---|
| Database | `supabase/migrations/20261107000000_v2_client_gmail.sql` |
| Connect / disconnect | `supabase/functions/client-gmail/index.ts` |
| Sending and scheduled run | `supabase/functions/mailer/index.ts` |
| Shared helpers | `supabase/functions/_shared/gmail.ts` |
| Schedule | `supabase/golive/4-schedule-mailer.sql` |
| Deploy settings | `supabase/config.toml` (`verify_jwt = false` for both functions) |
| Screens | `Sampadha-v2/broker-email.js`, `api.js`, `research-reports.js`, `broker-email.css` |

## Database contract

Consent version becomes `BAE-2026-11-07`. Every `Active` consent on an older version becomes
`Pending`, so each client consents again to the new wording, and each of those clients gets a
`client_notifications` row asking them to connect Gmail and consent again.

`v2.client_gmail_tokens`: `client_id` (pk, references `v2.profiles` on delete cascade),
`gmail_address`, `refresh_token_enc`, `scope`, `updated_at`. RLS on, no policies, **no grant to
authenticated**, all to `service_role`.

`v2.gmail_oauth_states`: `state_hash` (pk), `client_id` (references profiles, cascade), `created_at`,
`expires_at`. Same privileges as the tokens table.

`v2.client_gmail_links`: `client_id` (pk, cascade), `gmail_address`, `status` (`Connected`,
`Reconnect needed`, `Disconnected`), `connected_at`, `disconnected_at`, `last_sent_at`, `last_error`,
`updated_at`. Readable by the client (own row) and admin, sales, ra. Select to authenticated, all to
`service_role`. No token material lives here.

`v2.email_log` gains `send_via text not null default 'smtp'` (`smtp` or `client_gmail`),
`alerted_at timestamptz` and `attempts int not null default 0` (SMTP tries of an `Order alert`).

`v2.mailer_heartbeat`: one row, `id` (always true), `last_cron_at`. The mailer writes it at the start of
every scheduled run. Readable by admin, all to `service_role`.

`v2.save_broker_email`: `p_consent = true` raises `Connect your Gmail first` unless the client's link
is `Connected`.

`v2_private.broker_instruction_lines(report_id, client_id)`: one line per order, newline separated:

- Multi leg: `buy 3 lots NIFTY 17NOV 25000 PE at market, target 180, stop-loss 95`. Side lower-case.
  Contract is `contract_name` when it says more than the symbol, else built from the leg. `at market`
  only when the leg has no price; a stated entry always goes out, `at 120` or `at 120 - 125`, even on
  a `CMP` leg, so a limit is never lost. Target and stop-loss only when set.
- Cash reports are not sent: uploaded PDFs hold no order lines, and the consent covers Multi only.
- Tier: reports can mix tiers, so only legs whose product is the client's active subscription
  `multi_tier` go out. The old names count: Nano is Bronze, Micro Silver, Mini Palladium, Mega Platinum,
  Giga Gold. Case and outer spaces do not matter (`v2_private.multi_tier_of`).
- Closed legs: a leg with status `Closed`, no `remaining_lots`, or an expiry before today in
  Asia/Kolkata is left out (`v2_private.broker_live_legs`). A partly closed leg goes out at its
  `remaining_lots`. `Generated` and `Open` legs go out: delivery fires before the legs open.

`v2_private.broker_instruction_body(broker_client_id, lines, test)`:

```text
Dear Team,

for THFGHF -
buy 3 lots NIFTY 17NOV 25000 PE at market

Thanks
```

A test body starts with `TEST EMAIL - sample only. Do not place any order.` and a blank line.

Subject: `Trade Instructions 7/11/2026 for - THFGHF of Angel One` (IST, no leading zeros). Test
subjects start with `TEST - `.

`v2_private.queue_broker_order()` (same trigger): no Active consent, or a report with no legs: do
nothing. If nothing is left to send for this client, because no live leg is of their tier or no leg is
live at all, send nothing and write the audit note `broker_email.nothing_to_send`.
Otherwise insert an `email_log` row with `mail_type 'Broker order'`, `send_via 'client_gmail'`,
`client_id`, TO, CC, subject and body. If the link is not `Connected`, insert the row with status
`Failed` and `provider_message 'The client''s Gmail is not connected'`, then call
`v2.broker_mail_alert`.

An order is never sent unfiltered. If a live leg's product is not a known tier, or the client has no
active tier, the row is `Failed` with no order lines in it, and is alerted the same way. If even the
`Failed` row cannot be written, the client gets a `client_notifications` row as a last resort. None of
this can stop the report reaching the client.

`v2.broker_mail_alert(p_mail_id uuid, p_reason text) returns void`: security definer. Does nothing if
`alerted_at` is set or the row is not a `Broker order`. Otherwise sets `alerted_at`, adds a
`client_notifications` row for the client, queues an `Order alert` email (`send_via 'smtp'`) to the
report's author, and writes the audit log. `service_role` only, plus internal callers. The fixed text
says "could not confirm"; the reason is quoted as given, and says `Not sent` only when that is certain.

`v2.send_broker_test_email`: client only (`Only the client can send a test from their own Gmail`).
Requires a `Connected` link. Inserts `mail_type 'Broker test'`, `send_via 'client_gmail'`. Same
hourly limit.

`v2.list_broker_email_clients()` gains `gmail_status text` and `gmail_address text`.

## client-gmail function

Environment: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_TOKEN_KEY`
(base64 of 32 random bytes), `PORTAL_URL` (default `https://racrm.fintecindia.com`).

- `POST {action:'start'}`: signed-in active client who passed the sign-in code. Stores the SHA-256 of a
  random state (10 minute expiry). Returns `{ url }` for Google with `response_type=code`,
  `access_type=offline`, `prompt=consent`, `login_hint=<portal email>`, and scopes
  `openid email https://www.googleapis.com/auth/gmail.send`.
- `GET ?code&state` (Google's redirect): takes the state once, swaps the code, requires the granted
  scope to include `gmail.send` and a verified email equal (lower-case) to the client's portal email.
  On mismatch it revokes the grant and stores nothing. A revoke ends the whole grant of that Google
  account, so it is skipped if any client's link has that address `Connected`, and one client cannot
  end another's connection. Saves the encrypted refresh token, marks the
  link `Connected`, writes audit `client_gmail.connected`, then redirects to
  `PORTAL_URL/?gmail=connected`. Failures redirect to `?gmail=mismatch`, `?gmail=denied` or
  `?gmail=failed`.
- `POST {action:'disconnect'}`: client. Revokes at Google, deletes the token, marks the link
  `Disconnected`, sets any `Active` or `Pending` consent to `Revoked`, writes audit
  `client_gmail.disconnected`.

## mailer function

New environment: same `GOOGLE_*` and `GMAIL_TOKEN_KEY`, plus `MAILER_CRON_SECRET`.

- `send_via = 'smtp'` rows behave as today, except as below.
- `send_via = 'client_gmail'` rows go only through the Gmail API, under the rules above. Broker orders
  are sent before other mail. Records the Gmail message id in `provider_message`, and `last_sent_at` on
  the link.
- `Sent` on a Gmail row means Gmail accepted it, not that the broker received it. The client's page
  shows it as `Accepted by Gmail`.
- Just before sending, an order is also refused if the client's profile is no longer active (tests
  too), or if `consented_at` is later than the row's `sent_at`: a changed broker ID, a removed CC or a
  withdraw and re-consent must not release an older queued order.
- A client's Gmail rows go one at a time, oldest first, so a buy and its exit keep their order. A
  group holds at most one row per client, and none for a client with a row still `Sending`. The others
  wait for a later group.
- The link becomes `Reconnect needed` on `invalid_grant`, HTTP 401, a Gmail 403 whose `reason` is an
  approval problem (`insufficientPermissions`, `authError`, `forbidden`) or missing, and a stored token
  that cannot be decrypted. A 403 with a limit `reason` (`rateLimitExceeded`, `userRateLimitExceeded`,
  `dailyLimitExceeded`, `quotaExceeded`) or any other reason is `Failed` with an alert, says `Not sent`,
  and leaves the link as it is.
- Every failed or expired `Broker order` calls `broker_mail_alert`. A failed `Broker test` does not.
- An `Order alert` that fails on SMTP goes back to `Queued` on each scheduled run, 5 tries in all, then
  stays `Failed`. While SMTP is not set up it stays `Failed`, never `Simulated`, and is tried once SMTP
  is set up.
- `POST {action:'cron'}` with header `x-cron-secret` (constant-time compare; no user token): writes the
  heartbeat, marks stale `Sending` rows, retries failed `Order alert` rows, flushes, then alerts any
  `Failed` or `Expired` order with `alerted_at` null. A stale smtp row is resent only if it is under an
  hour old; an older one is `Failed`.
- `POST {action:'status'}` (admin): SMTP details plus `gmailConfigured`, `cronSecretConfigured`,
  `lastCronAt` and `stuckBrokerOrders`, the count of orders `Queued` or `Sending` for over 5 minutes.
  The Admin panel shows a red warning if the last run is over 5 minutes ago or missing, or the count
  is above 0, and says separately whether SMTP and client order sending (Gmail) are set up.
- `flush` keeps working for signed-in users.

## Rows in the queue when the migration runs

- `Queued` smtp `Broker order`: `Failed`, alerted. It would have left from Sampadha's mailbox.
- `Queued` smtp `Broker test`: `Failed`, no alert.
- `Sending` smtp `Broker order`, up to an hour old: `Failed` and alerted, saying delivery is unknown,
  because the old mailer may have sent it (rules 1 and 3).
- `Sending` smtp `Broker test`, up to an hour old: `Failed`, delivery unknown, no alert.
- Any `Sending` smtp row over an hour old: `Failed`, delivery unknown, `alerted_at` set, no alert.
- `Sending` smtp rows of other kinds, up to an hour old: left for the mailer's stale check.
- `Failed` and `Expired` orders already there get `alerted_at`, so nobody is alerted about history.
- Other `Queued` mail is left alone.

## Going live

1. Google Cloud: enable the Gmail API, create a Web OAuth client, and set the redirect URI to
   `https://nxtyswlxnmekpvlfuucg.supabase.co/functions/v1/client-gmail`. Add test users while in
   Testing (connections expire after 7 days until Google approves the app).
2. Run the migration in the SQL Editor.
3. Set the secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
   `GMAIL_TOKEN_KEY`, `MAILER_CRON_SECRET`.
4. Deploy:
   `npx supabase functions deploy client-gmail --project-ref nxtyswlxnmekpvlfuucg --use-api --no-verify-jwt`
   `npx supabase functions deploy mailer --project-ref nxtyswlxnmekpvlfuucg --use-api --no-verify-jwt`
   Both check callers themselves; Google's redirect and the schedule carry no Supabase token.
   `supabase/config.toml` sets the same `verify_jwt = false`, so a redeploy without the flag cannot
   lock them out.
5. Run `supabase/golive/4-schedule-mailer.sql`, after storing `mailer_cron_secret` in Vault. The Admin
   mail panel stays red until the first scheduled run has reported in.
6. Publish the site: `npm run publish:v2`.

Do step 6 last. The screens need the new database fields.
