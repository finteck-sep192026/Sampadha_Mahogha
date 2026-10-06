# Sampadha Four-Role Wealth Portal Prototype

Responsive portal with role-based navigation, backed by a Supabase (PostgreSQL) database, using fictional Indian wealth-management data.

The supplied Sampadha logo is packaged at `assets/sampadha-logo.png` and used on both the branded login screen and portal sidebar. Premium presentation overrides are maintained in `brand-premium.css`.

## Premium color toolbar

Use the floating color button on the login screen or **Theme** in the portal toolbar. Four selectable themes are included:

- Sapphire Gold — signature wealth-management palette and default
- Onyx Copper — executive dark-luxury palette
- Emerald Platinum — institutional green palette
- Ivory Navy — understated private-banking palette

The selected theme is stored locally in the browser.

## Accounts and sign-in

Sign-in is verified by Supabase Auth on the server — there are no passwords in this repository or in the browser code. Enter a staff/client ID (for example `CL-1001`) or an email address plus the password.

The 18 fictional accounts (1 Admin `ADM-001`, 1 Research Analyst `RA-024`, 3 Sales `SAL-011/018/026`, 13 Clients `CL-1001`–`CL-1013`) are created by `npm run seed:demo` with random passwords written to `demo-credentials.local.txt` (git-ignored). See the root `README.md` for setup.


## Included modules

### Workflow chart

- Available from every role's left menu
- Shows secure login and role separation
- Maps Sales onboarding and RA research as parallel lanes
- Shows the Admin approval/rejection control gate
- Includes automatic submission and decision emails
- Ends with client portal access, subscriptions, payments, recommendations and audit review

### Admin

- Platform KPIs and recent activity
- User and role access register
- Strategies and research reports
- Single and batch report generation
- Client list, KYC onboarding and subscription plans
- Subscribed products, payments and recommendations
- Audit trail

### Research Analyst

- Create and preview Multi reports with repeatable MULTI RECOMMENDATIONS entries. Add recommendation appends another complete set of input fields; no stock dropdown is used.
- Entry fields: Product, Symbol, Expiry date, Strike price, Option type, Buy/Sell, No. of lots, Lot size, Quantity, Initiation price, Published date, Delivered date and Status. Quantity is calculated; delivered date is filled after sending; status starts Active.
- Four required research text boxes: Technical, Derivatives, Quantitative and Risks.
- Client selection appears only AFTER the report is previewed and you verify a 6-digit code from your authenticator app (set up once with a QR code). The code is checked by the server; it must be entered after the draft was created, within 5 minutes, and authorises exactly one send. This is not an Aadhaar eSign.
- Nano, Micro, Mini, Mega and Giga checkboxes filter clients by sample subscription. Multiple types show the union of matching clients. Deselecting a type removes hidden client selections. Select visible clients and Clear checkboxes affect client selections; typed IDs/emails must also match the selected types.
- Sample subscriptions: Nano — CL-1001, CL-1006, CL-1011; Micro — CL-1002, CL-1007, CL-1012; Mini — CL-1003, CL-1008, CL-1013; Mega — CL-1004, CL-1009; Giga — CL-1005, CL-1010.
- **Add leg** duplicates the complete previous leg so the analyst can change only the required fields. All entered leg details are shown in a table in the report and on the separate Orders page.
- Sending creates one order per leg. RA and Admin have separate **Open**, **Partially Closed**, and **Closed** tabs. Each exit records its closing price and quantity. The portal calculates cumulative closed quantity, weighted average closing price, and remaining quantity. An order moves to Partially Closed when only part of the quantity is exited, and to Closed only when the remaining quantity reaches zero. Repeat delivery does not duplicate orders. These are demo recommendation positions, not broker trades.
- Select recipients using client checkboxes or comma/space-separated client IDs and emails
- Unknown recipients are rejected and duplicate delivery is skipped
- Selected clients can open Reports received and download reports as a landscape PDF. Every duplicated Add leg entry is shown as one row in a full-column recommendation table, followed by the four research sections and signing details.
- Reports, deliveries, orders and exits are stored in the database. Mail records are logged in the portal only (status "Simulated"); no external email is sent yet.

- Research dashboard
- Strategy register
- Single-stock report creation
- Multiple-stock batch report creation
- Every generated report receives a demo report ID and India Standard Time date/time stamp

### Sales

- Sales profile
- Client relationship table
- Complete Add Client form with personal, PAN, contact, income and tax-residency details
- Share-market fields: broker, depository, Demat/BO ID, trading client ID, bank, experience and enabled market segments
- Suitability fields: risk profile, horizon, objective, proposed amount, loss tolerance and preferred plan
- Client consent confirmation and submission to the Admin queue
- Automatic submission-confirmation email record
- KYC onboarding form and progress tracker
- Quarterly/annual subscription-plan options

### Admin client approval

- Submitted clients receive a unique application ID and IST submission timestamp
- New records remain **Pending** and cannot become approved from the Sales login
- Admin opens **Client approvals** to review market-account and suitability details
- Only Admin can approve or reject an application in this prototype
- Approval or rejection automatically creates a second client email record
- Admin and Sales can review recipient, subject, status, timestamp and message preview under **Email delivery**

### Client

- View-only personal profile
- Subscribed products: Cash, Multi and All
- Payment details for quarterly and annual billing
- Recommendation table with filters for product, stock, from date, to date and status
- Dummy stocks: TCS, KOTAK, INFY, SBI, ICICI, HERO, JIO and LALITHA
- Published date and time stamp on every recommendation
- Client notification inbox with confirmation-email previews

## Confirmation email sequence

1. After Add Client submission: “Application received and pending Admin review.”
2. After Admin approval: “Your Sampadha client account is approved.”
3. After Admin rejection: “Your application requires changes.”

The prototype simulates these messages locally. Real delivery requires a transactional email service, a verified sender domain, delivery webhooks and server-side audit storage.

## Technology used

- HTML5, responsive CSS3, vanilla JavaScript (no build step)
- Supabase (PostgreSQL, Auth, Row Level Security) — see `supabase/` and the root `README.md`


## Main source files

- `index.html` — login and portal shell
- `portal.css` — responsive premium interface
- `brand-premium.css` — Sampadha navy, blue and gold brand finish
- `theme-toolbar.css` — theme chooser interface
- `client-onboarding.css` — onboarding, approval and email-delivery screens
- `role-app.js` — roles, screens, filters, session handling
- `research-reports.js` — research reports, authenticator signing, orders and PDF export
- `api.js` — the only file that talks to the database
- `config.js` — public Supabase URL and publishable key

## Production integrations recommended

- ASP.NET Core Web API or Next.js API layer
- Microsoft Entra ID / Azure AD B2C for authentication
- Server-side role-based authorization; never rely only on hidden navigation
- Azure SQL or PostgreSQL for users, clients, subscriptions and recommendations
- Immutable report timestamps generated on the server
- Azure Blob Storage for reports and KYC documents
- Payment gateway integration and webhook verification
- Encryption, audit logs, consent records, MFA and secure secret storage

This prototype does not send emails, process payments, place trades or store real personal/financial information.
