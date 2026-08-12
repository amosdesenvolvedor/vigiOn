import { env } from '../../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string) {}
  async send(message: EmailMessage) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) throw new Error(`EMAIL_PROVIDER_HTTP_${response.status}`);
  }
}

export class UnavailableEmailProvider implements EmailProvider {
  async send() {
    throw new Error('EMAIL_PROVIDER_UNAVAILABLE');
  }
}

export const emailProvider: EmailProvider = env.RESEND_API_KEY
  ? new ResendEmailProvider(env.RESEND_API_KEY)
  : new UnavailableEmailProvider();

export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
