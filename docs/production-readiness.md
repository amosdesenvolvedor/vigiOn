# Production readiness — Prompt 18

Validation date: 2026-08-13. Production: `https://vigion.cloud`.

## Deployed architecture

Caddy is the only public application boundary on TCP 80/443 and UDP 443. SSH is exposed for operations. React/Nginx (`127.0.0.1:5173`), Express API (`127.0.0.1:3000`), MariaDB 11.4 (`127.0.0.1:3306`) and MinIO (`127.0.0.1:9000`) are private to the host and Docker network. Persistent volumes hold MariaDB, MinIO and Caddy state. The VM is the single failure domain.

External integrations are Stripe Live, Resend, Web Push and customer-operated edge gateways. Secrets are provided only through the production environment and are not recorded here. Caddy manages the Let's Encrypt certificate and HTTPS redirect.

The API schedules five persisted-health workers: stream cleanup, media retention, gateway reconciliation, notification dispatch and billing reconciliation. Liveness proves the process is serving; readiness fails closed unless MariaDB, MinIO and all five workers are healthy and fresh.

## Evidence

- Authentication production E2E: two identified `TEST-P18` organizations registered successfully; access token, refresh rotation, logout and revoked refresh were exercised. Invalid and anonymous tokens returned 401.
- Multi-tenancy production E2E: a camera owned by organization A returned 404 to organization B. Its supplied credential was absent from API output and the disposable camera was deleted through the API.
- Roles and tenant boundaries: automated API suite covers OWNER, ADMIN, OPERATOR, VIEWER and confirms tenant roles are not platform roles.
- Platform administration: database role is revalidated on every request; real TOTP enrollment, an MFA-verified session and authenticated `/platform` reads were observed. Ten unused recovery-code hashes exist; no code or secret was read during audit.
- Gateway/camera/storage/events/notifications/realtime: automated integration suites use the production schema and exercise pairing, secret verification, idempotent heartbeat/messages, stream lifecycle, private media, retention, event/rule flow, retry state, push ownership and cross-tenant realtime channels. No physical customer camera was modified.
- Stripe Live: the controlled BASIC checkout produced a PAID BRL payment, PAID invoice, ACTIVE Stripe subscription and BASIC plan/entitlements. All 15 recorded webhook events were PROCESSED. The frontend supplies a plan code only; price mapping and organization identity are server-owned. No second charge was created during Prompt 18.
- Checkout concurrency: an organization-scoped unique active lock exists and a regression test proves a losing concurrent request reuses the active checkout without calling Stripe again.
- Email: Resend and sender variables are configured. Delivery behavior is covered by provider/notification tests; no unsolicited production email was generated for readiness.
- Logging: controlled 400/401 requests contained request IDs in structured logs. A scan found no known Stripe secret, webhook secret, MFA key, bearer token, refresh cookie or test camera password patterns.
- HTTP: valid Let's Encrypt certificate, HSTS, `nosniff`, strict referrer policy and restrictive permissions policy were observed. CORS remains explicit and credentialed.

## Billing catalogue and entitlements

The database remains authoritative: FREE 1 camera/1 GiB/1 day/1 user; BASIC 3/10 GiB/7 days/3 users; PRO 8/100 GiB/15 days/10 users; BUSINESS 20/1 TiB/30 days/50 users. Enabled feature arrays remain those stored in `Plan`; enforcement is centralized in `EntitlementService`.

The validated Live subscription is not canceled automatically. Cancellation is an externally consequential operation and must be explicitly requested by the account owner; the normal mechanism schedules cancellation at period end.

## Backup and disaster recovery

Cron runs daily at 03:17 with 14-day retention. The 2026-08-13 controlled run produced restricted database and MinIO archives, both passed SHA-256 verification, and MariaDB restored into an isolated temporary database with 43 tables. The temporary database was removed. Configuration snapshots were moved outside the repository to a permission-restricted directory.

Engineering targets remain RPO 24 hours and RTO 4 hours. Off-host encrypted replication and restore on a replacement VM remain operational improvements.

## Dependency and security review

The pruned production dependency tree reports zero known vulnerabilities. Development-only tooling reports four advisories: one moderate (`esbuild`), two high dependency paths (`vite`/`postcss`) and one critical (`vitest`). Those packages are excluded from runtime images and no development server is exposed. Upgrade them in a controlled maintenance change.

RPC port 111 was not used by NFS and was disabled. MariaDB and MinIO remain loopback-only. Cloud ingress filtering was observed for RPC, while host UFW is currently inactive; Oracle Cloud network rules are therefore a security dependency.

## Restart and operational behavior

A controlled Docker service restart is required by the final checklist. A full VM reboot is intentionally not required solely for certification because it introduces unnecessary single-node risk. Docker restart policies, persistent volumes and service health checks provide the expected recovery mechanism.

## Residual risks

- Single VM concentrates proxy, API, workers, database and object storage; there is no automatic failover.
- Rate limits, realtime connections/tickets and worker scheduling are local to one API instance. Horizontal scale requires shared coordination/broker and leader election.
- MariaDB and MinIO are not replicated; backups reduce data-loss impact but do not provide high availability.
- Backups are currently local; encrypted off-host copy and independent alerting are still required.
- Host UFW is inactive; availability and exposure rely partly on Oracle Cloud ingress policy.
- Development dependency advisories require a planned tooling upgrade, although they are absent from production runtime.
- Physical camera/network behavior varies by customer environment and cannot be certified from the cloud VM alone; edge integration tests cover the protocol and failure classes.

## Decision

`GO`: all critical flows are evidenced and no P1 remains open. The known single-VM and operational risks remain accepted technical debt, not hidden guarantees of high availability.
