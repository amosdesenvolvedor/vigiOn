import type { PrismaClient } from '@prisma/client';

export function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: days[get('weekday')]!,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
  };
}
export function inLocalInterval(minute: number, start: number, end: number) {
  return (
    start === end ||
    (start < end ? minute >= start && minute < end : minute >= start || minute < end)
  );
}

export class ContextEngine {
  constructor(private readonly prisma: PrismaClient) {}
  async gather(eventId: string) {
    const event = await this.prisma.cameraEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { organization: true },
    });
    if (event.type !== 'MOTION' || !event.cameraId)
      return {
        event,
        outOfHours: false,
        sensitiveZone: false,
        persistent: false,
        scheduleKnown: false,
      };
    const local = localParts(event.occurredAt, event.organization.timezone);
    const schedules = await this.prisma.monitoringSchedule.findMany({
      where: {
        organizationId: event.organizationId,
        OR: [{ cameraId: event.cameraId }, { scopeKey: 'ORG' }],
      },
      include: { intervals: true, exceptions: true },
    });
    const schedule =
      schedules.find((s) => s.cameraId === event.cameraId) ??
      schedules.find((s) => s.scopeKey === 'ORG');
    let expected = true;
    let scheduleKnown = Boolean(schedule);
    if (schedule?.mode === 'DISABLED') scheduleKnown = false;
    else if (schedule?.mode === 'SCHEDULED') {
      const exception = schedule.exceptions.find(
        (e) => e.localDate.toISOString().slice(0, 10) === local.localDate,
      );
      expected = exception
        ? exception.mode === 'OPEN' &&
          inLocalInterval(local.minute, exception.startMinute!, exception.endMinute!)
        : schedule.intervals.some(
            (i) =>
              i.weekday === local.weekday &&
              inLocalInterval(local.minute, i.startMinute, i.endMinute),
          );
    }
    const since = new Date(event.occurredAt.getTime() - 5 * 60_000);
    const recent = await this.prisma.cameraEvent.count({
      where: {
        organizationId: event.organizationId,
        cameraId: event.cameraId,
        type: 'MOTION',
        occurredAt: { gte: since, lte: event.occurredAt },
      },
    });
    const persistent =
      recent >= 3 ||
      Boolean(event.endedAt && event.endedAt.getTime() - event.occurredAt.getTime() >= 60_000);
    const sensitiveZone =
      (await this.prisma.cameraZone.count({
        where: {
          organizationId: event.organizationId,
          cameraId: event.cameraId,
          enabled: true,
          priority: 'HIGH',
        },
      })) > 0;
    return {
      event,
      outOfHours: scheduleKnown && !expected,
      sensitiveZone,
      persistent,
      scheduleKnown,
    };
  }
}
