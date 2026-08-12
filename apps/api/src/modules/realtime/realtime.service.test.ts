import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from './realtime.service';
class FakeResponse extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  write(value: string) {
    this.chunks.push(value);
    return true;
  }
  end() {
    this.ended = true;
    this.emit('close');
    return this;
  }
}
afterEach(() => vi.useRealTimers());
const context = (organizationId: string, userId: string) => ({
  organizationId,
  userId,
  membershipId: 'm',
  sessionId: 's',
  role: 'OWNER' as const,
});
describe('realtime tenant channels', () => {
  it('requires a ticket and never broadcasts across tenants', () => {
    const service = new RealtimeService();
    expect(service.consume('invalid')).toBeNull();
    const a = service.consume(service.createTicket(context('org-a', 'user-a')).ticket)!;
    const b = service.consume(service.createTicket(context('org-b', 'user-b')).ticket)!;
    const ra = new FakeResponse();
    const rb = new FakeResponse();
    expect(service.connect(a, ra as never)).toBe(true);
    expect(service.connect(b, rb as never)).toBe(true);
    service.publish('org-a', 'EVENT_CREATED', 'event-a');
    expect(ra.chunks.join('')).toContain('event-a');
    expect(rb.chunks.join('')).not.toContain('event-a');
  });
  it('limits connections per user', () => {
    const service = new RealtimeService();
    const ticket = service.consume(service.createTicket(context('org', 'user')).ticket)!;
    expect([1, 2, 3].every(() => service.connect(ticket, new FakeResponse() as never))).toBe(true);
    expect(service.connect(ticket, new FakeResponse() as never)).toBe(false);
  });
  it('expires long-lived connections so authentication is checked again', () => {
    vi.useFakeTimers();
    const service = new RealtimeService();
    const ticket = service.consume(service.createTicket(context('org', 'user')).ticket)!;
    const response = new FakeResponse();
    expect(service.connect(ticket, response as never)).toBe(true);
    vi.advanceTimersByTime(15 * 60_000);
    expect(response.ended).toBe(true);
  });
});
