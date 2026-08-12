import type { CameraEventType, EventSeverity, NotificationChannel, UserRole } from '@prisma/client';

const ranks: Record<EventSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export class AlertPolicyService {
  shouldCreateAlert(type: CameraEventType) {
    return type === 'MOTION' || type === 'CAMERA_OFFLINE' || type === 'GATEWAY_OFFLINE';
  }
  recoveryFor(type: CameraEventType): CameraEventType | null {
    return type === 'CAMERA_ONLINE'
      ? 'CAMERA_OFFLINE'
      : type === 'GATEWAY_ONLINE'
        ? 'GATEWAY_OFFLINE'
        : null;
  }
  isRecipient(role: UserRole) {
    return role !== 'VIEWER';
  }
  defaultEnabled(_type: CameraEventType, channel: NotificationChannel) {
    return channel === 'IN_APP';
  }
  meetsMinimum(actual: EventSeverity, minimum: EventSeverity) {
    return ranks[actual] >= ranks[minimum];
  }
}
