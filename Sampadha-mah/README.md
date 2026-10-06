# Sampadha Four-Role Wealth Portal Prototype

Interactive responsive front-end prototype with role-based navigation and fictional Indian wealth-management data.

The supplied Sampadha logo is packaged at `assets/sampadha-logo.png` and used on both the branded login screen and portal sidebar. Premium presentation overrides are maintained in `brand-premium.css`.

## Premium color toolbar

Use the floating color button on the login screen or **Theme** in the portal toolbar. Four selectable themes are included:

- Sapphire Gold — signature wealth-management palette and default
- Onyx Copper — executive dark-luxury palette
- Emerald Platinum — institutional green palette
- Ivory Navy — understated private-banking palette

The selected theme is stored locally in the browser.

## Demo logins

| Role | Email | Password | Access |
|---|---|---|---|
| Admin | `admin@sampadha.demo` | `Admin@123` | Full platform access |
| Research Analyst | `ra@sampadha.demo` | `RA@123` | Strategies and single/multiple reports |
| Sales — Sneha Kapoor | `sales@sampadha.demo` | `Sales@123` | Profile, clients, KYC and subscriptions |
| Sales — Arjun Mehta | `arjun.sales@sampadha.demo` | `Sales@456` | Profile, clients, KYC and subscriptions |
| Sales — Nisha Rao | `nisha.sales@sampadha.demo` | `Sales@789` | Profile, clients, KYC and subscriptions |
| Client — Priya Sharma | `client@sampadha.demo` | `Client@123` | View-only profile, products, payments and recommendations |
| Client — Arun Nair | `arun.client@sampadha.demo` | `Client@456` | View-only profile, products, payments and recommendations |
| Client — Meera Shah | `meera.client@sampadha.demo` | `Client@789` | View-only profile, products, payments and recommendations |
| Client — Vikram Reddy | `vikram.client@sampadha.demo` | `Client@321` | View-only profile, products, payments and recommendations |
| Client — Kavya Iyer | `kavya.client@sampadha.demo` | `Client@654` | View-only profile, products, payments and recommendations |
| Client — Rohan Desai | `rohan.client@sampadha.demo` | `Client@1006` | View-only client access |
| Client — Ananya Gupta | `ananya.client@sampadha.demo` | `Client@1007` | View-only client access |
| Client — Suresh Patel | `suresh.client@sampadha.demo` | `Client@1008` | View-only client access |
| Client — Divya Menon | `divya.client@sampadha.demo` | `Client@1009` | View-only client access |
| Client — Karan Malhotra | `karan.client@sampadha.demo` | `Client@1010` | View-only client access |
| Client — Pooja Joshi | `pooja.client@sampadha.demo` | `Client@1011` | View-only client access |
| Client — Nikhil Verma | `nikhil.client@sampadha.demo` | `Client@1012` | View-only client access |
| Client — Shreya Rao | `shreya.client@sampadha.demo` | `Client@1013` | View-only client access |

Includes 3 Sales accounts and 13 Client accounts. Enter your account ID or email and password directly. The portal automatically opens the matching role. IDs and emails are case-insensitive; passwords are case-sensitive. There is no account dropdown or role selector.

Client IDs CL-1001 through CL-1013 correspond to the clients listed above in order. Sales IDs: Sneha SAL-011, Arjun SAL-018, Nisha SAL-026. Admin: ADM-001. Research Analyst: RA-024. These are front-end demo logins; sample research and financial tables are shared demo data.

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
- Client selection appears only AFTER report preview and demo Aadhaar OTP verification. Tick consent, request OTP, enter 123456, then verify. Verification is tied to the report and signed-in user, expires after five minutes, and resets on navigation, sign-out or sending. No real Aadhaar data or SMS is used; this is not a legally valid Aadhaar eSign.
- Nano, Micro, Mini, Mega and Giga checkboxes filter clients by sample subscription. Multiple types show the union of matching clients. Deselecting a type removes hidden client selections. Select visible clients and Clear checkboxes affect client selections; typed IDs/emails must also match the selected types.
- Sample subscriptions: Nano — CL-1001, CL-1006, CL-1011; Micro — CL-1002, CL-1007, CL-1012; Mini — CL-1003, CL-1008, CL-1013; Mega — CL-1004, CL-1009; Giga — CL-1005, CL-1010.
- **Add leg** duplicates the complete previous leg so the analyst can change only the required fields. All entered leg details are shown in a table in the report and on the separate Orders page.
- Sending creates one order per leg. RA and Admin have separate **Open**, **Partially Closed**, and **Closed** tabs. Each exit records its closing price and quantity. The portal calculates cumulative closed quantity, weighted average closing price, and remaining quantity. An order moves to Partially Closed when only part of the quantity is exited, and to Closed only when the remaining quantity reaches zero. Repeat delivery does not duplicate orders. These are demo recommendation positions, not broker trades.
- Select recipients using client checkboxes or comma/space-separated client IDs and emails
- Unknown recipients are rejected and duplicate delivery is skipped
- Selected clients can open Reports received and download reports as a landscape PDF. Every duplicated Add leg entry is shown as one row in a full-column recommendation table, followed by the four research sections and signing details.
- Reports and simulated delivery records exist only in the current browser session; refreshing clears them. No external email is sent. Sign out and sign in as a selected client in the same tab to view a delivered report.

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

- HTML5
- Responsive CSS3
- Vanilla JavaScript
- Browser-session dummy data; no database or external API

## Main source files

- `index.html` — login and portal shell
- `portal.css` — responsive premium interface
- `brand-premium.css` — Sampadha navy, blue and gold brand finish
- `theme-toolbar.css` — theme chooser interface
- `client-onboarding.css` — onboarding, approval and email-delivery screens
- `role-app.js` — roles, permissions, screens, filters and dummy data

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
