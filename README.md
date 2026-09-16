# TradeSlot Server

Backend API for **TradeSlot** — a chat-driven booking platform. Customers book a local trader's service slots through an in-page webchat widget (and future WhatsApp), pay online via Stripe, and funds are split between the platform and the trader through Stripe Connect.

- **Live API:** https://tradeslot-server.onrender.com/api/v1
- **Repository:** https://github.com/AbuBakkarSiddique007/TradeSlot_Server
- **Frontend:** https://github.com/AbuBakkarSiddique007/TradeSlot_Client

---

## Money Model

Every booking follows the same flat-pricing flow (currency: `gbp`):

| Actor          | Amount                         |
| -------------- | ------------------------------ |
| Customer pays  | £100 (`FLAT_JOB_PRICE_GBP`)    |
| Platform keeps | £15  (`FLAT_BOOKING_FEE_GBP`)  |
| Trader payout  | £85  (via Stripe Connect)      |

Implementation: a **destination charge** on the trader's connected Stripe account with `application_fee_amount` (platform fee) and `transfer_data` (trader payout).

## Tech Stack

| Layer     | Technology                                   |
| --------- | -------------------------------------------- |
| Runtime   | Node.js 20+, TypeScript (ESM), `tsx` watch   |
| HTTP      | Express 5                                    |
| ORM       | Prisma 7 (`prisma-client` generator) + `pg` / `@prisma/adapter-pg` |
| Database  | PostgreSQL                                   |
| Auth      | JWT (`jsonwebtoken`) + bcrypt                |
| Payments  | Stripe (Connect + Checkout/PaymentIntents)   |
| Build     | tsup → `dist/`                               |
| Package   | pnpm                                         |

## Getting Started

### Prerequisites

- Node.js 20+, pnpm 10+
- A PostgreSQL database (local or hosted, e.g. Neon/Render)

### 1. Install

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3. Generate the Prisma client

The client is generated into `src/generated/prisma` (gitignored). It is required before `dev`/`build`:

```bash
pnpm prisma:generate
```

### 4. Apply the schema

```bash
pnpm prisma:migrate   # development migrations
# or
pnpm prisma:push      # push schema without migration files
```

### 5. Run

```bash
pnpm dev   # http://localhost:5000 (code fallback: 4000)
```

Verify with `GET /health` → `200 OK`.

## Environment Variables

| Variable                          | Required | Description                                                        |
| --------------------------------- | -------- | ------------------------------------------------------------------ |
| `PORT`                            | No ¹     | HTTP port (default 5000)                                           |
| `DATABASE_URL`                    | Yes      | PostgreSQL connection string                                       |
| `JWT_SECRET`                      | Yes      | Secret for signing auth tokens                                     |
| `STRIPE_SECRET_KEY`               | Yes      | Stripe key for charges + Connect                                   |
| `STRIPE_WEBHOOK_SECRET`           | Yes      | `whsec_…` for verifying Stripe webhooks                            |
| `PUBLIC_BASE_URL`                 | Yes      | Public server origin (webhook return URLs)                         |
| `CLIENT_BASE_URL`                 | Yes      | Allowed CORS origin (the Vercel app)                               |
| `FLAT_BOOKING_FEE_GBP`            | Yes      | Platform fee per booking (15.00)                                   |
| `FLAT_JOB_PRICE_GBP`              | Yes      | Customer price per job (100.00)                                    |
| `BUSINESS_TZ`                     | No       | IANA timezone pinned as process TZ (default `Asia/Dhaka`)          |
| `BUSINESS_UTC_OFFSET_MINUTES`     | No       | Offset for the business-day key (default 360 = UTC+6)              |
| `WHATSAPP_MODE`                   | No       | `mock` (default, log-only) or `meta` for the real Graph API        |
| `WHATSAPP_PHONE_NUMBER_ID`        | No       | Meta Cloud API phone number ID                                     |
| `WHATSAPP_ACCESS_TOKEN`           | No       | Meta system-user access token                                      |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`   | No       | Webhook GET verification token                                     |
| `WHATSAPP_APP_SECRET`             | No       | Meta app secret (webhook signatures, later phase)                  |

¹ `PORT` defaults to `5000` from `.env` or `4000` in code fallback.

## Available Scripts

| Command                | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `pnpm dev`             | Watch-mode dev server (`tsx watch src/server.ts`)  |
| `pnpm build`           | Bundle to `dist/` (`tsup`, ESM)                    |
| `pnpm start`           | Run the compiled build                             |
| `pnpm lint`            | ESLint over `src/**/*.{ts,tsx}`                    |
| `pnpm prisma:generate` | Generate Prisma client to `src/generated/prisma`   |
| `pnpm prisma:migrate`  | Create/apply development migrations                |
| `pnpm prisma:push`     | Push schema directly to the database               |
| `pnpm prisma:pull`     | Pull schema from the database                      |
| `pnpm prisma:studio`   | Open Prisma Studio over the database               |

## API Endpoints

Base: `/api/v1`

| Method   | Endpoint                          | Auth    | Description                                        |
| -------- | --------------------------------- | ------- | -------------------------------------------------- |
| `GET`    | `/health`                         | Public  | Health check                                       |
| `POST`   | `/auth/register`                  | Public  | Register a trader                                  |
| `POST`   | `/auth/login`                     | Public  | Login, returns JWT                                 |
| `GET`    | `/auth/me`                        | Trader  | Current trader profile                             |
| `GET`    | `/trader/availability`            | Trader  | Available slots for a date range                   |
| `POST`   | `/trader/work-area`               | Trader  | Set work-area zone + postal codes for a date       |
| `GET`    | `/trader/work-area`               | Trader  | Get work-area zones                                |
| `POST`   | `/trader/stripe/onboard`          | Trader  | Start Stripe Connect onboarding                    |
| `GET`    | `/trader/stripe/return`           | Public  | Connect onboarding return (before auth router)     |
| `GET`    | `/trader/stripe/refresh`          | Public  | Connect onboarding refresh link                    |
| `GET`    | `/trader/leads`                   | Trader  | Out-of-area / no-zone leads                        |
| `POST`   | `/channels/webchat/message`       | Public  | Webchat inbound message → booking engine           |
| `GET`    | `/channels/whatsapp/message`      | Public  | WhatsApp webhook verification handshake            |
| `POST`   | `/channels/whatsapp/message`      | Public  | WhatsApp inbound message → booking engine          |
| `POST`   | `/webhooks/stripe`                | Public ¹ | Stripe event webhook (Checkout/PaymentIntents)     |

¹ Signature-verified with the Stripe webhook secret; the route keeps `express.raw()`.

> **Note:** trader routes mount `requireTraderAuth` at the Router level. Onboarding `return`/`refresh` are declared **before** that middleware so they stay public.

## Architecture

```text
src/
  server.ts                     # Bootstrap, timezone pin
  app.ts                        # Express app, CORS (locked to CLIENT_BASE_URL)
  app/
    lib/prisma.ts               # PrismaClient + pg adapter
    routes/index.ts             # /api/v1 mount table
    middleware/auth.middleware.ts
    module/                     # Feature modules
      auth/       register, login, me
      workArea/   zones + postal codes per day
      availability/ slot computation
      channels/    webchat + WhatsApp adapters
      stripe/      Connect onboarding + checkout
      webhooks/    Stripe event handler
      leads/       out-of-area capture
    services/
      time.ts            business-day key + TZ pin
      bookingEngine.ts   conversation state machine
      bufferEngine.ts    slot buffering / overlap guard
      locationRouter.ts  zone detection → slots | lead
      inbox/             inbound → session → engine
      stripeService.ts   checkout, charges, transfers
      channels/          adapters (webchat, WhatsApp mock)
prisma/schema.prisma      data model
scripts/e2e-stripe.ts     end-to-end Stripe test harness
```

### Conversation state machine

Customers are driven through states stored on `ChatSession`:

`INITIAL → AWAITING_SERVICE_DETAILS → AWAITING_SLOT_SELECTION → OFFERED_SLOT → AWAITING_PAYMENT / AWAITING_CONTACT_DETAILS → CONFIRMED → COMPLETED`

Out-of-area or no-zone requests are diverted to a `LEAD` state and surfaced in the leads panel.

### Business-day & timezone model

Slots and work-area zones are keyed by a **business day** (UTC-midnight date key of `Asia/Dhaka`, offset `BUSINESS_UTC_OFFSET_MINUTES`). `time.ts` pins `process.env.TZ = BUSINESS_TZ` (default `Asia/Dhaka`) so dev machines (Bangladesh local time) and UTC hosts (Render) compute the same day key — no more “no zone today” bugs caused by host-local midnight.

## Prisma 7 Notes

- Client is generated with the new `prisma-client` generator to `src/generated/prisma` and is **gitignored** — run `pnpm prisma:generate` after cloning or editing `prisma/schema.prisma`.
- Prisma 7 has no Rust engine: the client is built on `@prisma/adapter-pg` (`src/app/lib/prisma.ts`), and `prisma.config.ts` loads `DATABASE_URL` from `.env`.

## WhatsApp Channel

The WhatsApp bridge currently runs in **`mock` mode**: inbound messages are logged and echoed to a log file, and the booking flow is fully exercised through the shared engine. Enabling the real Meta Cloud API later requires:

1. `WHATSAPP_MODE=meta` + phone number ID / access token / app secret in `.env`
2. An **published** Meta app (test-mode apps only receive dashboard test webhooks), a production phone number, and a stable HTTPS callback URL (e.g. the Render URL)
3. Implementing outbound messages via the Graph API (deferred phase)

The booking flow is channel-agnostic, so webchat and WhatsApp share `bookingEngine.ts` / `bufferEngine.ts` / `inbox/` unchanged.

## Stripe E2E Test

`scripts/e2e-stripe.ts` runs the full payment loop against Stripe test mode:

```bash
pnpm exec tsx scripts/e2e-stripe.ts
```

It creates a booking + Checkout Session, confirms a PaymentIntent in test mode, fires signed webhooks at the local server, and asserts the booking reaches `PAID` / the chat session `CONFIRMED`.

## Deployment (Render)

1. Push the repo to GitHub and import it in **Render** as a web service.
2. Health check path: `/health`.
3. Set all required env vars (see table above).
4. Build command: `pnpm && pnpm prisma:generate && pnpm build` — start command: `pnpm start`.

> **Security notes:** `.env` is gitignored and never committed; CORS is locked to `CLIENT_BASE_URL`; the Stripe webhook is signature-verified on a raw body.