import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { TenantContext } from '../tenancy/tenant-context';

export type RealtimeTopic =
  | 'EVENT_CREATED'
  | 'DEVICE_STATUS_CHANGED'
  | 'ALERT_CHANGED'
  | 'NOTIFICATION_CREATED';
type Ticket = { userId: string; organizationId: string; expiresAt: number };
type Client = { userId: string; response: Response };
export class RealtimeService {
  private tickets = new Map<string, Ticket>();
  private clients = new Map<string, Set<Client>>();
  private sequence = 0;
  createTicket(context: TenantContext) {
    this.cleanup();
    const token = randomBytes(32).toString('base64url');
    this.tickets.set(token, {
      userId: context.userId,
      organizationId: context.organizationId,
      expiresAt: Date.now() + 60_000,
    });
    return { ticket: token, expiresAt: new Date(Date.now() + 60_000) };
  }
  consume(ticket: string) {
    this.cleanup();
    const value = this.tickets.get(ticket);
    if (!value || value.expiresAt <= Date.now()) return null;
    this.tickets.delete(ticket);
    return value;
  }
  connect(ticket: Ticket, response: Response) {
    const existing = this.clients.get(ticket.organizationId) ?? new Set<Client>();
    if ([...existing].filter((c) => c.userId === ticket.userId).length >= 3) return false;
    const client = { userId: ticket.userId, response };
    existing.add(client);
    this.clients.set(ticket.organizationId, existing);
    response.on('close', () => {
      existing.delete(client);
      if (!existing.size) this.clients.delete(ticket.organizationId);
    });
    return true;
  }
  publish(organizationId: string, type: RealtimeTopic, entityId: string, occurredAt = new Date()) {
    const clients = this.clients.get(organizationId);
    if (!clients?.size) return;
    const id = String(++this.sequence);
    const payload = JSON.stringify({
      protocolVersion: 1,
      type,
      entityId,
      occurredAt: occurredAt.toISOString(),
    });
    for (const client of clients) {
      if (!client.response.write(`id: ${id}\nevent: dashboard\ndata: ${payload}\n\n`)) {
        client.response.end();
      }
    }
  }
  heartbeat() {
    for (const clients of this.clients.values())
      for (const client of clients) client.response.write(': keepalive\n\n');
  }
  private cleanup() {
    const now = Date.now();
    for (const [token, ticket] of this.tickets)
      if (ticket.expiresAt <= now) this.tickets.delete(token);
  }
}
export const realtimeService = new RealtimeService();
