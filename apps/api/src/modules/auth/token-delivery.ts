import { env } from '../../config/env';
import type { TokenDelivery } from './auth.types';

class ResendTokenDelivery implements TokenDelivery {
  constructor(private readonly apiKey: string) {}

  sendPasswordReset(email: string, token: string) {
    const url = `${env.APP_URL}/?resetToken=${encodeURIComponent(token)}`;
    return this.send(
      email,
      'Redefina sua senha no VigiOn',
      `Recebemos uma solicitação para redefinir sua senha. O link expira em breve:\n\n${url}\n\nSe você não solicitou, ignore esta mensagem.`,
      `<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${url}">Definir nova senha</a></p><p>O link expira em breve. Se você não solicitou, ignore esta mensagem.</p>`,
    );
  }

  sendEmailVerification(email: string, token: string) {
    const url = `${env.APP_URL}/?verifyEmail=${encodeURIComponent(token)}`;
    return this.send(
      email,
      'Confirme seu e-mail no VigiOn',
      `Confirme seu endereço de e-mail:\n\n${url}`,
      `<p>Confirme seu endereço para concluir seu cadastro.</p><p><a href="${url}">Verificar e-mail</a></p>`,
    );
  }

  private async send(to: string, subject: string, text: string, html: string) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  }
}

const unavailableDelivery: TokenDelivery = {
  async sendPasswordReset() {
    throw new Error('Email delivery is not configured');
  },
  async sendEmailVerification() {
    throw new Error('Email delivery is not configured');
  },
};

export const tokenDelivery: TokenDelivery = env.RESEND_API_KEY
  ? new ResendTokenDelivery(env.RESEND_API_KEY)
  : unavailableDelivery;
