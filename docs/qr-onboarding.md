# QR onboarding analysis

Prompt 2 implements capture, local decoding, safe classification and catalog candidate matching. It does not provision, connect, authenticate or create a camera.

## Capture decision

The web application uses the existing `@zxing/browser` 0.1.x dependency. It is loaded dynamically only after an explicit camera or image action, decodes locally, has a small focused API, and does not upload camera frames or images. Only the decoded text is sent for analysis. The stream is stopped after a read, cancellation, close, failure or component unmount. Rear-facing video is preferred with `facingMode: environment`. Upload and manual text are always available fallbacks.

## Trust boundary

`POST /api/v1/camera-onboarding/qr/analyze` treats the payload as untrusted input. It accepts at most 8192 UTF-8 bytes, rejects unsafe control characters and mass assignment, and constrains JSON depth, field count, field names and string length. URLs are classified only: the API performs no fetch, redirect, DNS resolution, internal-address probing or command execution.

Raw payloads, identifiers, tokens, activation codes, URLs and credentials are excluded from server logs. Telemetry records only event name, failure reason, organization/user context, request ID and safe analysis metadata. `POST /api/v1/camera-onboarding/qr/telemetry` accepts an allowlist of events and reasons.

## Classification and matching

Types are `VIGION`, `MANUFACTURER_SERIAL`, `MANUFACTURER_UID`, `MANUFACTURER_TOKEN`, `MANUFACTURER_PROPRIETARY`, `URL`, `TEXT`, `JSON`, `NETWORK_CONFIGURATION` and `UNKNOWN`. Identifier types remain distinct. No manufacturer-specific proprietary format is assumed.

VigiOn recognition is limited to a strict HTTPS URL on the configured `APP_URL` origin at `/qr/camera/<UUID>`, without user info, query or fragment. This recognizes the VigiOn envelope but does not authenticate a camera or authorize an action. Plain `VIGION:` prefixes are not recognized. No new signing or provisioning scheme is introduced.

Catalog matching uses only explicit manufacturer/brand and model/alias values, plus an explicit hardware version, variant name or SKU when supplied. Comparisons are exact after Unicode/case/whitespace normalization; there is no fuzzy matching. The result may contain multiple variants and always requires user confirmation. `LOW` and `UNKNOWN` are never presented as confirmed.

No persistence or migration is required. Tenant identity is derived from the authenticated session; the global catalog is read-only in this flow. Analysis does not create a `Camera` or onboarding record.

## Physical validation status

Automated validation covers payload handling, catalog matching, API authentication/rate limiting and log redaction. Webcam hardware, desktop without webcam, Android camera, iOS/Safari camera, permission dialogs and physical QR images require device testing and must be reported as not physically validated until performed.
