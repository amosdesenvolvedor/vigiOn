import { describe, expect, it } from 'vitest';
import { classifyCameraFailure, isAcceptedQrImage } from './qrScannerSupport';

describe('QR scanner browser fallbacks', () => {
  it('distinguishes denied, busy, absent and unsupported cameras', () => {
    expect(classifyCameraFailure({ name: 'NotAllowedError' }, true)).toBe('PERMISSION_DENIED');
    expect(classifyCameraFailure({ name: 'NotReadableError' }, true)).toBe('CAMERA_IN_USE');
    expect(classifyCameraFailure({ name: 'NotFoundError' }, true)).toBe('CAMERA_NOT_AVAILABLE');
    expect(classifyCameraFailure(new Error('missing API'), false)).toBe('UNSUPPORTED_BROWSER');
  });

  it('rejects invalid and oversized image uploads', () => {
    expect(isAcceptedQrImage({ type: 'image/png', size: 1024 })).toBe(true);
    expect(isAcceptedQrImage({ type: 'text/plain', size: 1024 })).toBe(false);
    expect(isAcceptedQrImage({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe(false);
  });
});
