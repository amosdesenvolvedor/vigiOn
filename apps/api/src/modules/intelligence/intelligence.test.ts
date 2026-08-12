import { describe, expect, it } from 'vitest';
import { inLocalInterval, localParts } from './context-engine';
import { RiskEngine } from './risk-engine';
import { scheduleSchema, zoneSchema } from './intelligence.schemas';

describe('event intelligence primitives', () => {
  it('uses IANA timezone and distinguishes two local times', () => {
    const instant = new Date('2026-08-12T03:30:00.000Z');
    expect(localParts(instant, 'America/Porto_Velho')).toMatchObject({
      localDate: '2026-08-11',
      minute: 1410,
    });
    expect(localParts(instant, 'Europe/Lisbon')).toMatchObject({
      localDate: '2026-08-12',
      minute: 270,
    });
  });
  it('handles daytime and overnight interval boundaries', () => {
    expect(inLocalInterval(480, 480, 1080)).toBe(true);
    expect(inLocalInterval(1080, 480, 1080)).toBe(false);
    expect(inLocalInterval(1380, 1320, 360)).toBe(true);
    expect(inLocalInterval(300, 1320, 360)).toBe(true);
    expect(inLocalInterval(720, 1320, 360)).toBe(false);
  });
  it('calculates deterministic bounded and explainable risk', () => {
    const engine = new RiskEngine();
    expect(engine.calculate([])).toMatchObject({
      score: 0.1,
      riskLevel: 'LOW',
      classification: 'NORMAL_ACTIVITY',
    });
    expect(engine.calculate(['OUT_OF_HOURS'])).toMatchObject({
      score: 0.45,
      riskLevel: 'MEDIUM',
      classification: 'OUT_OF_HOURS_ACTIVITY',
    });
    const high = engine.calculate(['OUT_OF_HOURS', 'SENSITIVE_ZONE', 'PERSISTENT_ACTIVITY']);
    expect(high).toMatchObject({
      score: 0.9,
      riskLevel: 'VERY_HIGH',
      classification: 'POSSIBLE_INTRUSION',
    });
    expect(high.factors).toHaveLength(3);
    expect(high.explanation.length).toBeGreaterThan(0);
    expect(high.score).toBeLessThanOrEqual(1);
  });
  it('validates polygons and rejects classification/risk spoofing', () => {
    expect(
      zoneSchema.safeParse({
        cameraId: '00000000-0000-4000-8000-000000000000',
        name: 'Caixa',
        priority: 'HIGH',
        enabled: true,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
      }).success,
    ).toBe(true);
    expect(
      zoneSchema.safeParse({
        cameraId: '00000000-0000-4000-8000-000000000000',
        name: 'X',
        priority: 'HIGH',
        polygon: [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({
        cameraId: null,
        mode: 'ALWAYS',
        intervals: [],
        riskScore: 1,
        classification: 'POSSIBLE_BREAK_IN',
      }).success,
    ).toBe(false);
  });
});
