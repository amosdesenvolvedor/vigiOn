import { describe, expect, it } from 'vitest';
import { MotionAggregator, MotionDetector } from './motion-detector';

describe('MotionDetector', () => {
  it('ignores identical frames and small noise', () => {
    const detector = new MotionDetector('HIGH');
    const stable = Buffer.alloc(100, 80);
    expect(detector.analyze(stable).motion).toBe(false);
    expect(detector.analyze(Buffer.from(stable)).motion).toBe(false);
    const noise = Buffer.from(stable);
    noise[0] = 100;
    noise[1] = 100;
    expect(detector.analyze(noise).motion).toBe(false);
  });

  it('reports the changed-area percentage for a significant change', () => {
    const detector = new MotionDetector('MEDIUM');
    detector.analyze(Buffer.alloc(100, 0));
    const changed = Buffer.alloc(100, 0);
    changed.fill(255, 0, 25);
    expect(detector.analyze(changed)).toEqual({ motion: true, motionScore: 0.25 });
  });
});

describe('MotionAggregator', () => {
  it('aggregates continuous motion into one event and closes after stable frames', () => {
    const times = [new Date('2026-08-11T10:00:00Z'), new Date('2026-08-11T10:00:10Z')];
    const aggregator = new MotionAggregator(
      3,
      () => 'event-1',
      () => times.shift()!,
    );
    expect(aggregator.update(true, 0.2)).toBeNull();
    expect(aggregator.update(true, 0.3)).toMatchObject({ state: 'STARTED', eventId: 'event-1' });
    for (let index = 0; index < 100; index += 1) expect(aggregator.update(true, 0.4)).toBeNull();
    expect(aggregator.update(false, 0)).toBeNull();
    expect(aggregator.update(false, 0)).toBeNull();
    expect(aggregator.update(false, 0)).toEqual({
      state: 'ENDED',
      eventId: 'event-1',
      occurredAt: '2026-08-11T10:00:00.000Z',
      endedAt: '2026-08-11T10:00:10.000Z',
      motionScore: 0.4,
    });
  });
});
