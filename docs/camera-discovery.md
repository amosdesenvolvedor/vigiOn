# Camera discovery

Prompt 3 adds tenant-scoped, ephemeral camera discovery. The Cloud queues commands for the already paired Gateway; it never opens sockets to a private network. Discovery confirms a physical candidate only and does not authenticate, provision or create a `Camera`.

## Gateway mechanism

The Gateway implements ONVIF WS-Discovery (`NetworkVideoTransmitter`) over UDP multicast `239.255.255.250:3702`. Multicast TTL is 1. Scan duration is 45 seconds by default and is bounded to 5–60 seconds in the agent. Each session is cancellable through an `AbortController`; sockets and timers close after completion, cancellation or error.

Interfaces are derived from the Gateway host. Only non-loopback private IPv4 addresses are used. Known container bridges, virtual Ethernet, VPN/tunnel and virtual-machine interfaces are excluded. A response must originate from the same subnet as the selected interface. The Gateway accepts at most 32 candidates and 65,535 bytes per datagram.

An ONVIF response is evidence, not compatibility. `XAddr` is parsed but never fetched. Its HTTP(S) hostname must equal the UDP response source; embedded credentials and unrelated hosts are rejected. No TCP port scan, RTSP request, SOAP device call, credential attempt or media operation occurs.

## Protocol

The existing authenticated command polling and acknowledgement protocol is extended with:

- `CAMERA_DISCOVERY_START`
- `CAMERA_DISCOVERY_CANCEL`
- `POST /api/v1/gateway-agent/discovery/results`

Commands retain `commandId`, tenant/gateway database scope, protocol version, timestamp, expiry and redelivery semantics. Results contain a unique `messageId`; the Cloud stores it in `GatewayMessage` to make duplicate delivery harmless. Late, expired, canceled, wrong-tenant and wrong-gateway results are rejected or ignored.

## Correlation

Observed capabilities are stored separately as `{ ONVIF_DISCOVERY: true }`. Catalog expectations are not modified. Matching uses exact normalized manufacturer/model/hardware values only when actually supplied by an observed source, plus an exact ONVIF endpoint reference when it was previously confirmed. IP contributes no identity points.

Confidence categories are `EXACT`, `HIGH`, `MEDIUM`, `LOW` and `UNKNOWN`. Match factors are stored for internal audit but not exposed by the user API. Multiple candidates are always returned separately. Existing cameras are checked only inside the same organization using strong observed identity; `ALREADY_REGISTERED` blocks confirmation.

## Persistence and privacy

`CameraDiscoverySession` expires after 10 minutes. A cleanup job runs every 15 minutes and removes expired state. Candidates cascade with their session. The API returns camera-relevant fields only and excludes endpoint references, raw XML, XAddr, scopes, hostnames, arbitrary ports/services and match internals.

Audit and telemetry events contain tenant/session/gateway identifiers, duration/count/status metadata, and never credentials, QR payloads, tokens or unrelated LAN inventory.

## Physical validation

Automated tests validate parsing, subnet and XAddr restrictions, payload boundaries, tenant isolation, offline gateways, duplicate and late results, confidence levels, duplicate-camera protection, cancellation, expiration and cleanup. Physical ONVIF devices and real network interfaces remain unvalidated until a compatible Gateway build is installed on hardware in the target LAN.
