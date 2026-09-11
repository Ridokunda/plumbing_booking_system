# Architecture

WeFixIt is a server-rendered modular monolith. It keeps deployment simple while
still separating HTTP routes, domain rules, persistence, and presentation.

```mermaid
flowchart LR
  Browser[Responsive EJS UI] --> Security[Security headers, CSRF, sessions, rate limits]
  Security --> Routes[Role-scoped Express routers]
  Routes --> Domain[Validation and lifecycle rules]
  Routes --> Integrations[Resend and Stripe adapters]
  Routes --> DB[(MySQL 8)]
  DB --> Sessions[Revocable sessions]
  DB --> Operations[Bookings, schedules, quotes and jobs]
  DB --> Records[Invoices, PDF receipts, reviews and audit history]
  DB --> Cases[Disputes, refunds and reschedule requests]
```

## Roles and boundaries

- Customers own requests, approve quotes, confirm completed work, pay, and review.
- Plumbers manage availability, assigned work, evidence, notes, and quotes.
- Administrators verify plumbers, schedule jobs, manage accounts, and triage enquiries,
  disputes, reschedules, and provider-backed refunds.
- Every protected route verifies both authentication and the required role server-side.

## Booking lifecycle

```mermaid
stateDiagram-v2
  [*] --> NEW
  NEW --> ASSIGNED: admin schedules
  NEW --> DECLINED: admin declines
  NEW --> CANCELLED: customer cancels
  ASSIGNED --> IN_PROGRESS: plumber starts
  IN_PROGRESS --> COMPLETED: plumber completes
  COMPLETED --> PAID: verified payment webhook
  PAID --> [*]
```

Invalid transitions return `409 Conflict`; updates record the actor, prior state,
new state, time, and note in `booking_status_history`.

## Security decisions

- Authentication uses one server-side session model stored in MySQL.
- Passwords use bcrypt; reset and verification tokens are random and stored only as hashes.
- State-changing browser requests require a session-bound CSRF token.
- Login, registration, contact, and reset operations are rate-limited.
- Uploads are size-, extension-, MIME-, and file-signature-limited; secrets stay in environment variables.
- CSP, anti-framing, content-type, referrer, permissions, and production HSTS headers are applied centrally.
- Stripe is authoritative through signed, idempotent webhooks. Simulation is opt-in for demos.

## Data model

The migration in `database/migrations/001_initial_schema.sql` is the source of truth.
Core relationships are `users -> bookings -> quotes/invoices/reviews`, with separate
tables for preferred dates, availability, status history, job notes, photos, notifications,
and completion confirmation.

## Operational model

- `/health/live` verifies the process; `/health/ready` verifies database access.
- `npm run db:migrate` applies ordered, recorded migrations.
- Docker Compose starts MySQL, runs migrations once, and then starts the app.
- CI performs migration and schema checks, formatting, linting, tests, both role and full-lifecycle
  smoke tests, and dependency auditing.
