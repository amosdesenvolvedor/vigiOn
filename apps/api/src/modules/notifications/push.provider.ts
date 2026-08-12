import webPush from 'web-push';
import { env } from '../../config/env';

export type PushMessage = {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  path: string;
};

export interface PushProvider {
  readonly available: boolean;
  send(message: PushMessage): Promise<void>;
}

class WebPushProvider implements PushProvider {
  readonly available = Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY);

  constructor() {
    if (this.available)
      webPush.setVapidDetails(
        env.WEB_PUSH_SUBJECT,
        env.WEB_PUSH_VAPID_PUBLIC_KEY!,
        env.WEB_PUSH_VAPID_PRIVATE_KEY!,
      );
  }

  async send(message: PushMessage) {
    if (!this.available) throw new Error('PUSH_NOT_CONFIGURED');
    await webPush.sendNotification(
      {
        endpoint: message.endpoint,
        keys: { p256dh: message.p256dh, auth: message.auth },
      },
      JSON.stringify({
        title: message.title,
        body: message.body,
        path: safePath(message.path),
      }),
      { TTL: 300, urgency: 'high' },
    );
  }
}

export const safePath = (path: string) =>
  /^\/(?:monitoring|alerts|events|notifications)(?:[/?#][a-zA-Z0-9_?&=#.-]*)?$/.test(path)
    ? path
    : '/monitoring';

export const pushProvider = new WebPushProvider();
