# Security hardening and threat model

## Trust boundaries

The public boundary is Caddy. The API, MariaDB and MinIO are private services. Tenant identity is derived from the authenticated access token and revalidated membership, never from client-supplied organization IDs. Stripe and gateway traffic cross separate signed/secret-authenticated boundaries.

## Threat model

| Threat | Likelihood | Impact | Existing mitigation | Remaining risk / action |
| --- | --- | --- | --- | --- |
| Credential stuffing and brute force | Medium | High | Argon2id and endpoint limits | Move limit state to Redis before multiple API replicas |
| Session/JWT theft and refresh replay | Medium | High | short access JWT, HttpOnly Strict cookie, rotation and family revocation | revoke exposed sessions and investigate audit trail |
| Privileged account compromise | Medium | Critical | database role revalidation and TOTP MFA per verified session | retain offline recovery procedure |
| Tenant escape / IDOR | Low | Critical | tenant-scoped repositories and negative tests | preserve regression suite on every release |
| XSS / CSRF | Medium | High | React escaping, Helmet, strict refresh cookie and bearer mutations | keep dependencies patched; avoid unsafe HTML |
| SQL/command/path injection | Low | Critical | Prisma parameters, schema validation, FFmpeg without shell, controlled media keys | validate every new connector/input |
| SSRF through camera URLs | Medium | High | camera traffic belongs on the edge gateway | gateway deployments must block cloud metadata/private destinations not explicitly configured |
| Webhook/gateway impersonation | Medium | Critical | Stripe signature, idempotent event ledger, hashed gateway secrets | rotate secrets through documented procedure |
| Media/ticket enumeration | Low | High | tenant checks, signed short-lived tickets and private MinIO | URLs may leak through clients; do not log query tokens |
| SSE/push abuse | Medium | Medium | one-time tickets and endpoint limits | in-memory state requires shared broker for horizontal scale |
| CPU/disk/storage exhaustion | Medium | High | bounded uploads, stream concurrency and retention | monitor capacity and apply host-level quotas |
| Billing tampering/duplication | Medium | Critical | trusted Stripe webhooks, server-side price map, event idempotency, one active checkout lock | reconcile failed events and remote/local drift |
| Secret or backup theft | Medium | Critical | secrets outside image/repository, private volumes, backup checksums | copy encrypted backups off-host with restricted credentials |
| Dependency compromise | Low | High | lockfile and reproducible builds | audit on each release; investigate before forced upgrades |
| Single VM failure | Medium | Critical | restart policies and backups | recovery requires a replacement host; no automatic failover |

## MFA

Platform administrators must enroll RFC 6238-compatible TOTP before `/platform` is available. Secrets use AES-256-GCM with a dedicated `MFA_ENCRYPTION_KEY`. Enrollment is pending until a valid code is confirmed. Ten one-time recovery codes are returned once and stored only as SHA-256 hashes. A TOTP time step or recovery code cannot be replayed. Disable requires password plus a current MFA factor and revokes all sessions.

## Stateful components and scaling

MariaDB, MinIO, stream files, SSE connections and rate-limit counters are stateful. The current deployment is intentionally single API instance. Before horizontal API scale, use Redis or equivalent for rate limits/tickets/pub-sub, move worker scheduling to leader-elected jobs, and use shared stream/object storage. MariaDB and MinIO need their own replication/failover design.
