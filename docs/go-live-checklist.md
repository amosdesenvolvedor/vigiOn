# Vigion Cloud go-live checklist

Evidence date: 2026-08-13.

- [x] DNS — `vigion.cloud` resolves to the production VM.
- [x] TLS — valid Let's Encrypt certificate; HTTPS and HSTS observed.
- [x] Frontend — production document and public support/legal routes return successfully.
- [x] API — liveness and authenticated production E2E passed.
- [x] MariaDB — healthy, loopback-only and migration-compatible.
- [x] MinIO — healthy, loopback-only, private media tests passed.
- [x] Workers — all five persisted states are HEALTHY.
- [x] Gateway — pairing, invalid secret, duplicate message, offline and tenancy integration tests passed.
- [x] Camera — connection/credential/schema and tenancy tests passed; disposable production camera removed.
- [x] MFA — real Platform Admin enrollment, MFA-verified session and `/platform` access observed; replay, rate-limit and recovery reuse covered by security controls/tests.
- [x] Stripe Live — controlled BASIC payment, signed webhooks, ACTIVE subscription and PAID invoice/payment observed.
- [ ] Stripe cancellation — P3: subscription intentionally retained; cancel at period end only with owner authorization.
- [x] Stripe idempotency — duplicate webhook regression test and persisted unique event ledger.
- [x] Checkout concurrency — active organization lock and regression test.
- [x] Email — Resend/sender configured; provider behavior tested without unsolicited live message.
- [x] Backup — daily 03:17 job, 14-day retention, fresh restricted archives and valid SHA-256.
- [x] Restore — isolated restore succeeded with 43 tables and cleanup.
- [x] Observability — request ID, structured logs, secret-pattern scan and persisted worker health.
- [x] Security headers — HSTS, nosniff, referrer and permissions policies observed.
- [x] Network exposure — database/storage/API/web loopback-only; unused RPC disabled.
- [x] Migrations — 17 migrations applied with no divergence before Prompt 18 code-only validation changes.
- [x] Full final suite — API 28 suites/97 tests and Gateway 3 suites/9 tests passed; lint, typecheck and build passed.
- [x] Billing/entitlements — BASIC Live state and all four stored plan limits verified.
- [x] Controlled service restart — services recovered with persistent volumes and readiness/workers healthy.
- [x] GO decision — GO; no P1 remains open.

No unchecked P3/P4 item alone blocks production. Any unchecked P1 item requires `NO-GO`.
