export type MotionSensitivity = 'LOW' | 'MEDIUM' | 'HIGH';

const changedAreaThreshold: Record<MotionSensitivity, number> = {
  LOW: 0.18,
  MEDIUM: 0.1,
  HIGH: 0.05,
};

export class MotionDetector {
  private previous?: Buffer;
  constructor(
    private readonly sensitivity: MotionSensitivity,
    private readonly pixelDifferenceThreshold = 24,
  ) {}

  analyze(frame: Buffer) {
    if (!this.previous || this.previous.length !== frame.length) {
      this.previous = Buffer.from(frame);
      return { motion: false, motionScore: 0 };
    }
    let changed = 0;
    for (let index = 0; index < frame.length; index += 1)
      if (Math.abs(frame[index]! - this.previous[index]!) >= this.pixelDifferenceThreshold)
        changed += 1;
    this.previous = Buffer.from(frame);
    const motionScore = changed / frame.length;
    return { motion: motionScore >= changedAreaThreshold[this.sensitivity], motionScore };
  }
}

export type MotionTransition =
  | { state: 'STARTED'; eventId: string; occurredAt: string; motionScore: number }
  | { state: 'ENDED'; eventId: string; occurredAt: string; endedAt: string; motionScore: number };

export class MotionAggregator {
  private consecutiveMotion = 0;
  private consecutiveStable = 0;
  private active: { eventId: string; occurredAt: string; maxScore: number } | undefined;

  constructor(
    private readonly stableFramesToEnd: number,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  update(motion: boolean, score: number): MotionTransition | null {
    if (motion) {
      this.consecutiveMotion += 1;
      this.consecutiveStable = 0;
      if (this.active) {
        this.active.maxScore = Math.max(this.active.maxScore, score);
        return null;
      }
      if (this.consecutiveMotion < 2) return null;
      const occurredAt = this.now().toISOString();
      this.active = { eventId: this.createId(), occurredAt, maxScore: score };
      return { state: 'STARTED', ...this.active, motionScore: score };
    }
    this.consecutiveMotion = 0;
    if (!this.active) return null;
    this.consecutiveStable += 1;
    if (this.consecutiveStable < this.stableFramesToEnd) return null;
    const endedAt = this.now().toISOString();
    const ended: MotionTransition = {
      state: 'ENDED',
      eventId: this.active.eventId,
      occurredAt: this.active.occurredAt,
      endedAt,
      motionScore: this.active.maxScore,
    };
    this.active = undefined;
    this.consecutiveStable = 0;
    return ended;
  }
}
