# Sende web

React + TypeScript + Vite web client for the Sende remittance platform.
Talks to the `sende-backend` API at `/api/v1` (proxied to `localhost:3000`
in dev — see `vite.config.ts`).

## Pages

- `/signup`, `/login` — auth, including the MFA-code step when a user has MFA enabled.
- `/dashboard` — tabs for Send money, Recipients, and Transaction history.

## Security notes for this scaffold

- Access tokens are held in memory only (`api/client.ts`), not localStorage — avoids XSS-readable token storage. Swap for an httpOnly cookie issued by the backend before shipping.
- Every send-money submission generates a fresh `Idempotency-Key` (`crypto.randomUUID()`) so a double-click or retried request can never create two transactions.
- Amounts are sent to the API as strings (minor units) to avoid floating-point precision loss on money values.
- No inline scripts/styles in `index.html`, to stay compatible with the backend's Content-Security-Policy header.

## Getting started

```bash
npm install
npm run dev     # http://localhost:5173, proxies /api to the backend on :3000
```

## What's next / not built yet

- KYC document capture UI (the backend's mock KYC provider has no hosted flow to embed yet — wire up the real vendor's SDK/widget here once selected).
- Transaction detail view with the full status-event timeline (the backend already returns `statusEvents` from `GET /transactions/:id`).
- Mobile app (React Native) — Phase 2 per the roadmap; this web client's `api/client.ts` contract is designed to be reused there.
