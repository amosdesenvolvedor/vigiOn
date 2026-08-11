export type LimitedResource = 'CAMERAS' | 'USERS' | 'STORAGE';

export class PlanLimitError extends Error {
  readonly status = 403;
  readonly code = 'PLAN_LIMIT_REACHED';
  readonly upgradeRequired = true;

  constructor(
    readonly resource: LimitedResource,
    readonly current: bigint | number,
    readonly limit: bigint | number,
  ) {
    super(`Plan limit reached for ${resource.toLowerCase()}`);
  }
}
