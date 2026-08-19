import { decryptRegistrationCredentials, type EncryptedStreamSource } from './stream-envelope';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CameraRegistrationRegistry {
  private readonly registered = new Set<string>();

  register(privateKey: string, payload: { cameraId?: string; encryptedCredentials?: EncryptedStreamSource }) {
    if (!payload.cameraId || !uuid.test(payload.cameraId) || !payload.encryptedCredentials) return 'FAILED' as const;
    if (this.registered.has(payload.cameraId)) return 'SUCCESS' as const;
    try {
      decryptRegistrationCredentials(privateKey, payload.encryptedCredentials);
      this.registered.add(payload.cameraId);
      return 'SUCCESS' as const;
    } catch {
      return 'FAILED' as const;
    }
  }
}
