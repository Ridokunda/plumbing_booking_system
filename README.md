# WeFixIt

WeFixIt is a full-stack field-service platform for plumbing and electrical businesses.
It demonstrates more than appointment CRUD: customers, verified tradespeople, and
operations staff collaborate through a controlled job lifecycle from request to review.

> Portfolio status: production-oriented reference implementation. Real Stripe and Resend
> integrations are optional; safe local/demo modes are documented below.

## Product capabilities

### Customer journey

- Register securely, verify email, sign in, and recover a forgotten password.
- Request one of four supported services with multiple preferred future dates and location.
- Edit or cancel requests only while their lifecycle permits it.
- Follow status history, assigned schedule, customer-visible job notes, and photo evidence.
- Review itemised quotes, approve pricing, confirm completed work, pay in ZAR, download
  PDF receipts, request reschedules/refunds, open disputes, and leave a verified review.

### Plumber journey

- Apply with licence and experience details, then await administrator verification.
- Publish available or unavailable time windows.
- See only assigned work; progress it from assigned to in-progress to completed.
- Create itemised, tax-aware quotes and attach before/after evidence and job notes.
- Build a public rating history from verified, paid jobs.

### Operations journey

- See booking, customer, plumber, and status metrics.
- Approve or reject plumber applications and suspend/deactivate accounts.
- Schedule only approved plumbers while checking availability and overlapping jobs.
- Assign, decline, and inspect jobs; triage contact enquiries, disputes, reschedules, and
  provider-backed refunds.

## Engineering highlights

- Express 5, EJS, MySQL 8, server-side sessions, and responsive Bootstrap UI.
- Ordered database migrations covering scheduling, quotes, audit history, invoices,
  payments, reviews, notifications, availability, and account tokens.
- Explicit role permissions and lifecycle transition rules with transaction-safe updates.
- Session-bound CSRF protection, rate limiting, bcrypt passwords, hashed reset tokens,
  secure headers, restricted uploads, parameterised SQL, and revocable DB sessions.
- Signed and idempotent Stripe payment/refund handling; email delivery through Resend when enabled.
- Downloadable PDF job cards and receipts generated from access-controlled database records.
- Health endpoints, Docker Compose, automated tests, linting, dependency auditing, and CI.

See [the architecture notes](docs/architecture.md) and [OpenAPI description](docs/api.yaml).

## Quick start with Docker

Requirements: Docker Desktop with Compose.

```bash
docker compose up --build
```

The Compose stack starts MySQL, waits for it to become healthy, applies migrations, and
serves the app at <http://localhost:3000>.

To load portfolio/demo accounts:

```bash
docker compose run --rm -e ALLOW_DEMO_SEED=true migrate npm run db:seed
```

The default demo password is `PortfolioDemo!2026` for these local-only accounts:

- `customer@wefixit.local`
- `plumber@wefixit.local`
- `admin@wefixit.local`

Set `DEMO_PASSWORD` to replace it. Never enable demo seeding in a real deployment.

## Local development

Requirements: Node.js 20.11+, npm 10+, and MySQL 8.

```bash
npm ci
copy env.template .env
npm run db:migrate
npm run db:verify
npm run dev
```

On macOS/Linux, use `cp env.template .env`. Update the database values and generate a
long random `SESSION_SECRET` before starting.

Useful commands:

```bash
npm run check       # JavaScript and EJS compilation
npm run lint        # correctness-focused lint rules
npm test            # unit and HTTP integration tests
npm audit           # dependency vulnerability report
npm run db:seed     # optional local demo data
npm run smoke:auth  # role-based HTTP smoke test after seeding
npm run smoke:workflow # full booking-to-payment lifecycle smoke test
npm run verify      # complete local static/unit quality gate
```

## Configuration

| Variable                                     | Required             | Purpose                                           |
| -------------------------------------------- | -------------------- | ------------------------------------------------- |
| `DB_HOST`, `DB_NAME`, `DB_USER`              | Yes                  | MySQL connection                                  |
| `DB_PASSWORD`, `DB_PORT`                     | Environment-specific | MySQL credentials and port                        |
| `SESSION_SECRET`                             | Yes                  | At least 32 characters; signs session cookies     |
| `COOKIE_SECURE`                              | Production           | Set `true` behind HTTPS                           |
| `APP_URL`                                    | Recommended          | Absolute callback and account-link base URL       |
| `REQUIRE_EMAIL_VERIFICATION`                 | No                   | Require verified email before login               |
| `EMAIL_API_KEY`, `EMAIL_FROM`                | No                   | Enables Resend transactional email                |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Production payments  | Stripe Checkout and signed webhooks               |
| `ENABLE_SIMULATED_PAYMENTS`                  | Demo only            | Enables clearly labelled local payment simulation |
| `TAX_RATE`                                   | No                   | Decimal quote tax rate; defaults to `0.15`        |

Refer to [`env.template`](env.template) for the complete example. Do not commit `.env`.

## Core lifecycle

```text
NEW -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> PAID
  \-> DECLINED
  \-> CANCELLED
```

Only the responsible role can make each transition. Quote approval, customer completion
confirmation, and provider-confirmed payment add independent evidence around the lifecycle.

## Project layout

```text
config/                 domain roles, services, and transition rules
database/migrations/    versioned MySQL schema
middleware/             authentication and request security
routes/                 role-scoped application workflows
utils/                  validation, mail, tokens, notifications, lifecycle helpers
views/                   EJS pages and shared partials
public/                  browser JavaScript, CSS, and images
scripts/                 checks, migrations, and demo seed
test/                    Node test runner unit and HTTP integration coverage
docs/                    architecture and API documentation
.github/workflows/       CI quality gate
```

## Deployment checklist

1. Use a managed MySQL database and run `npm run db:migrate` as a release step.
2. Supply unique secrets through the host's secret manager; set `COOKIE_SECURE=true`.
3. Configure persistent object storage for uploads rather than an ephemeral container disk.
4. Configure Stripe's webhook to `POST /payment/webhook` and set both Stripe secrets.
5. Enable Resend and email verification, terminate TLS at the proxy, and monitor
   `/health/live` and `/health/ready` separately.
6. Keep `ENABLE_SIMULATED_PAYMENTS` and `ALLOW_DEMO_SEED` disabled.

## Intentional next-scale choices

The modular monolith is deliberate for a portfolio-sized product. At higher volume, move
email/notification delivery to a queue, uploads to object storage, and rate-limit counters
to Redis. Split route persistence into repositories only when independent modules need it;
the current transaction boundaries remain explicit and easy to inspect.

## Licence

MIT — see [LICENSE](LICENSE).
