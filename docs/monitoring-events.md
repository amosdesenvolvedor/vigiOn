# Monitoring, motion detection and events

The gateway monitors enabled RTSP cameras independently from live viewing. The cloud remains the
authority for per-camera settings and sends encrypted stream configuration over the authenticated
gateway control plane.

## Motion pipeline

FFmpeg samples 1–5 grayscale frames per second at a configurable low resolution (default 320×180).
`MotionDetector` compares consecutive frames using a pixel-difference threshold and changed-area
percentage. Sensitivity maps to changed-area thresholds: LOW 18%, MEDIUM 10%, HIGH 5%.

Two consecutive motion samples start one event. Continuous motion updates the same local aggregate.
Stable samples for `motionCooldownSeconds` end it. This score measures visual change only; it is not
a risk score and does not imply a person, vehicle or intrusion.

The detector uses its own RTSP connection because the current HLS and capture pipelines do not expose
a shared decoded-frame router. A future media tee may reduce camera connections without changing the
event protocol.

## Delivery and security

Gateway events carry stable `eventId`, `messageId`, protocol version and UTC timestamps. A persistent
bounded queue retries delivery for up to its configured TTL. The API derives the organization from
gateway credentials, validates camera ownership, limits timestamps and metadata, rate-limits
ingestion, and deduplicates on `(gatewayId, externalEventId)`.

Gateway and camera connectivity events are created only on state transitions. Gateway offline state
is reconciled from `lastSeenAt`; recovery is detected on heartbeat. Camera state comes only from the
motion RTSP pipeline, never from storage, upload or browser failures.

## Timeline and retention

`GET /api/v1/events` provides tenant-scoped, newest-first pagination and filters for camera, gateway,
type, severity and date range. Event metadata is retained independently from media retention. When
enabled, motion creates an optional snapshot through the existing private Object Storage flow and
stores only its `StorageFile` relationship.

No notification delivery, AI classification, advanced detection zones or automatic recording is
implemented in this stage.
