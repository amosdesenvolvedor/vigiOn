# Production runbook

## Release

1. Confirm a clean reviewed commit and sanitized `.env.example`.
2. Run Prisma validate/generate, lint, typecheck, tests, build and dependency audit.
3. Create database and object-storage backups and verify checksums.
4. Deploy migrations once, then rebuild/restart services.
5. Smoke-test `/api/v1/health/live`, `/api/v1/health/ready`, login, MFA, tenant routes and a non-billing dashboard read.
6. Do not create charges, refunds, cancellations or rotate production secrets as a smoke test.

## Backup and restore

Run `scripts/backup-production.sh` from cron with a restricted destination. Keep at least 14 daily generations and copy encrypted archives to an off-host account. Alert when the command exits non-zero or no fresh archive exists. Run `scripts/restore-verify.sh BACKUP.sql.gz` regularly; it imports into a uniquely named temporary database, validates table count and removes only that temporary database. Never restore over production for a test.

MinIO restore must first target a disposable volume and be compared with database `StorageFile` records. Recovery order is MariaDB, MinIO, migrations/app version, API, web/proxy, then workers. Stripe remains the external billing source of truth and webhook reconciliation resumes after service recovery.

## Incidents

- Compromised user session: revoke all user sessions, reset password, verify MFA and inspect audit entries.
- Platform administrator compromise: suspend the account at the database/approved admin tool, revoke sessions, rotate MFA and relevant secrets, preserve logs.
- Gateway compromise: disable it, rotate the gateway secret, inspect commands/uploads/events, then re-pair deliberately.
- Stripe drift: stop checkout mutations if necessary, retain webhook payload identifiers, compare customer/subscription/invoice state and replay only verified Stripe events.
- Storage pressure: stop new streams/recordings before deleting anything, preserve metadata and apply retention through the application.

## Recovery objectives

Initial operational targets are RPO 24 hours and RTO 4 hours. These are engineering targets, not formal compliance guarantees. A single VM remains a critical dependency until database, object storage and API are deployed with tested redundancy.
