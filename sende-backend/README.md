# Sende backend

Modular-monolith API for the Sende remittance platform. Node.js + TypeScript
+ Fastify + Prisma/PostgreSQL. See the companion `Sende_Roadmap_and_Architecture.docx`
for the research, roadmap, and full architecture this scaffold implements.

## Modules

- `modules/auth` — signup/login, Argon2id password hashing, JWT issuance, TOTP MFA.
- `modules/kyc` — KYC/AML vendor interface (mock implementation; swap in Sumsub/Persona/Trulioo), signed webhook handler.
- `modules/ledger` — double-entry ledger core: balanced postings, append-only entries.
- `modules/transactions` — transaction state machine, orchestrates quote → funds collection → compliance screening → payout dispatch.
- `modules/fx` — FX quote provider interface with a short-TTL locked quote.
- `modules/payout` — payout aggregator interface (mock implementation; swap in Flutterwave/Cellulant for Africa, Thunes/Nium for South Asia), signed webhook handler.
- `modules/recipients` — recipient CRUD with field-level encryption on account numbers.
- `modules/admin` — staff-only compliance review queue and refund initiation, RBAC-gated.

## Security features implemented in this scaffold

- Argon2id password hashing, JWT auth, TOTP-based MFA enrollment/verification.
- RBAC middleware (`requireRole`) for staff-only endpoints.
- Idempotency-key enforcement on all money-moving endpoints.
- Field-level AES-256-GCM encryption helper for sensitive fields (recipient account numbers, MFA secrets).
- HMAC signature verification on inbound vendor webhooks (KYC decisions, payout confirmations).
- Double-entry ledger with a hard balance invariant — an unbalanced posting throws before it ever reaches the database.
- Immutable transaction status event log for full audit reconstruction.
- Global + per-route rate limiting, Helmet security headers, strict CORS, request body size limits.
- Structured logging with automatic redaction of secrets/PII fields.
- Env var validation at boot (`config/env.ts`) — the app refuses to start with a missing/short JWT secret.

## What's stubbed / needs a real integration before production

- **KYC/AML vendor**: `modules/kyc/kyc.service.ts` has a `MockKycProvider`; wire up Sumsub/Persona/Trulioo per the research doc.
- **FX rates**: `modules/fx/fx.service.ts` has hardcoded demo rates; wire up a real market-data feed.
- **Payout aggregator**: `modules/payout/payout.service.ts` has a `MockPayoutProvider`; wire up Flutterwave/Cellulant/Thunes/Nium.
- **KMS**: `utils/crypto.ts` derives its encryption key locally for dev convenience; use a real KMS (AWS KMS/Vault) in any deployed environment.
- **Refund workflow**: `modules/admin/admin.routes.ts` stubs the refund endpoint; implement offsetting ledger entries following the pattern in `transactions.service.ts`.
- **Balance check before debit**: `transactions.service.ts` notes where a real pre-debit balance check belongs (currently simplified for readability).

## Getting started

```bash
cp .env.example .env      # fill in a real JWT_SECRET (32+ chars) at minimum
docker compose up -d       # starts Postgres + Redis
npm install
npm run prisma:migrate     # creates the schema in your local Postgres
npm run dev                 # starts the API on http://localhost:3000
```

Health check: `GET /healthz`

## Testing

```bash
npm test          # unit tests (vitest)
npm run typecheck # strict TypeScript check, no emit
```
