export type ScanFailure =
  | 'PERMISSION_DENIED'
  | 'CAMERA_NOT_AVAILABLE'
  | 'CAMERA_IN_USE'
  | 'UNSUPPORTED_BROWSER'
  | 'NO_QR_DETECTED'
  | 'INVALID_IMAGE';

export function classifyCameraFailure(reason: unknown, mediaSupported: boolean): ScanFailure {
  const name =
    typeof reason === 'object' && reason !== null && 'name' in reason
      ? String((reason as { name: unknown }).name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'PERMISSION_DENIED';
  if (name === 'NotReadableError' || name === 'AbortError') return 'CAMERA_IN_USE';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'CAMERA_NOT_AVAILABLE';
  return mediaSupported ? 'CAMERA_NOT_AVAILABLE' : 'UNSUPPORTED_BROWSER';
}

export const isAcceptedQrImage = (file: Pick<File, 'type' | 'size'>) =>
  file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024;
