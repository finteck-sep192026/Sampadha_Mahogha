# Google verification pack: Sampadha Portal

Everything needed to submit the app in the Google Cloud Verification Center.

Project: `sampadha-portal`. Home page: `https://racrm.fintecindia.com`. Privacy policy:
`https://racrm.fintecindia.com/privacy.html`. Verified domain: `fintecindia.com`.

## Order

1. Connect Gmail once through the new route, and check the consent screen.
2. Record and upload the demo video below as **Unlisted** on YouTube.
3. Audience: press **Publish app**.
4. Verification Center: start verification, paste the text below, add the video link, and submit.

Verification Center only opens after Publish app. Google says this review can take up to 10 days.
Until it is approved, real clients see an "unverified app" warning and must press Advanced to
continue, with a limit of about 100 users.

## Scope justification

Paste this for `https://www.googleapis.com/auth/gmail.send`:

> Sampadha Portal is used by clients of Sampadha, a SEBI-registered Research Analyst. A client can
> choose to have the research recommendations they receive emailed to their stockbroker's dealing
> desk. Brokers accept order instructions from the email address registered with them, so the email
> has to be sent from the client's own Gmail account, not from Sampadha's mailbox.
>
> The client turns this on once, after reading a consent statement and approving access on Google's
> screen. The portal then sends each recommendation to the broker addresses shown to the client at
> consent. The client can see each email sent, and withdraw and disconnect at any time.
>
> We request only gmail.send because the feature only sends messages. We do not read, search, modify
> or delete mail. A narrower scope is not available: sending is the one thing the feature does, and
> gmail.compose or gmail.modify would grant more access than we need. Refresh tokens are encrypted
> at rest and deleted when the client disconnects.

## How the app uses Google data

Paste this if the form asks:

> We use the user's Google email address to confirm it matches their portal account, and the
> gmail.send permission to send order emails they have consented to. Google user data is not sold,
> not used for advertising, and not used to train AI models. Use of Google data follows the Google
> API Services User Data Policy, including the Limited Use requirements.

## Demo video script (about 2 minutes)

Record in English, with the browser address bar visible throughout. Google needs to see the client
ID in the address bar on the consent screen. Use a test client and a test mailbox you own, never a
live dealing desk.

1. **Home page (10 seconds).** Open `https://racrm.fintecindia.com`. Show the Sampadha name and the
   Privacy Policy link, then open the policy and scroll to "Connecting your Gmail".
2. **Sign in as a test client (10 seconds).** Open **Broker auto-email**.
3. **Explain the feature (10 seconds).** Show the Connect your Gmail card, and say that order emails
   go from the client's own Gmail and that the portal cannot read mail.
4. **Consent screen (25 seconds).** Press **Connect your Gmail**. Pause on Google's screen. Click into
   the address bar so the `client_id` is readable, then show the requested permission, "Send email on
   your behalf". Tick it and continue.
5. **Connected (10 seconds).** Back in the portal, show Connected and the Gmail address.
6. **Consent (15 seconds).** Show the broker details, tick the consent, and press **I consent**.
7. **The scope in use (30 seconds).** Sign in as the Research Analyst in a second window, send a Multi
   report to the test client, then open the test mailbox and show the order arriving from the
   client's Gmail address. Set up the test client with a test mailbox as the broker address first.
8. **Disconnect (15 seconds).** Press **Withdraw consent**, confirm, and show it disconnected.

## After approval

- Check the consent screen shows "Sampadha Portal".
- Real clients can then connect, without test-user limits or 7-day expiry.
- Keep the `google-site-verification` TXT record in the `fintecindia.com` DNS.
