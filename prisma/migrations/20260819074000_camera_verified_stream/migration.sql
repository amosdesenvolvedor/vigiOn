-- Prompt 5/7 follow-up: sanitized, credential-free RTSP source verified by the Gateway.
ALTER TABLE `CameraVerificationSession`
  ADD COLUMN `verifiedStream` JSON NULL;
