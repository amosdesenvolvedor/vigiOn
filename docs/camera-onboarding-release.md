# Camera onboarding and operational health

The onboarding chain is catalog → QR analysis → LAN discovery → candidate confirmation →
ONVIF/RTSP verification → camera completion → Gateway registration → operational health.
The Cloud never scans a customer's LAN or connects directly to a camera. QR payloads are
identification hints only and cannot select a host, port or credential.

## Gateway compatibility

- Verification requires Gateway 0.2.0 or newer.
- Secure camera registration requires Gateway 0.3.0 or newer.
- Operational health, retry and exact-identity IP rediscovery require Gateway 0.4.0 or newer.
- Older Gateways receive no health configuration; the API returns `upgradeRequired` and the
  manual retry endpoint returns `GATEWAY_UPDATE_REQUIRED`.

Credentials are encrypted at rest in the Cloud and re-encrypted to the Gateway's X25519 public
key. The Gateway retains decrypted camera data only in process memory while the camera is active.
JavaScript runtimes cannot promise cryptographic memory wiping; references are removed on disable,
unregister, resync and shutdown. No camera credential belongs in queue files or logs.

## Health policy

Checks use lightweight ONVIF and/or RTSP operations selected from verified capabilities. Initial
failures are `DEGRADED`; three consecutive failures produce `OFFLINE`. Scheduling uses jitter,
bounded concurrency and exponential backoff. Status batches are tenant/gateway scoped, replay
protected and sequence checked. Only transitions create connectivity events.

An IP address may be changed automatically only after WS-Discovery returns the exact persisted
ONVIF endpoint reference. Manufacturer/model similarity is never sufficient.

## Local integration tests

```sh
npm run test:db:up
DATABASE_URL=mysql://vigion_test:vigion-test-only@127.0.0.1:13307/vigion_test npm run test:integration
npm run test:db:down
```

The safety guard rejects non-local hosts and database names that are not explicitly test databases.

## Rollback

Application rollback means restoring the previous API/Web/worker container images. Migrations are
additive and preserve legacy cameras, allowing the previous application to run while the new columns
remain. Database rollback is not automatic: do not run reset, `db push`, or reverse destructive SQL.
If schema rollback is ever unavoidable, stop writes and restore the verified MariaDB and MinIO backup
into an isolated environment first, then follow the incident procedure.

## Physical validation track

No simulated run promotes a model to verified compatibility. A future hardware run must record:

- Gateway 0.4.0 inside the camera LAN;
- Android, iPhone/Safari and desktop onboarding;
- physical QR scanning and manual selection;
- TP-Link/Tapo, Intelbras and Reolink devices separately;
- ONVIF identity, RTSP playback, authentication rejection and credential update;
- DHCP IP change with exact endpoint identity;
- Gateway restart, offline interval, resync and health recovery.

Until that evidence exists, affected catalog entries remain `UNKNOWN` or `UNVERIFIED` and the UI
must use “Compatibilidade ainda não verificada.”
