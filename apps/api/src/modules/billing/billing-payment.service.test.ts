import { describe, expect, it } from 'vitest';
import { assertSubscriptionTransition } from './billing-payment.service';

describe('subscription billing lifecycle', () => {
  it('allows only explicit subscription transitions', () => {
    expect(() => assertSubscriptionTransition('TRIALING', 'ACTIVE')).not.toThrow();
    expect(() => assertSubscriptionTransition('ACTIVE', 'PAST_DUE')).not.toThrow();
    expect(() => assertSubscriptionTransition('PAST_DUE', 'ACTIVE')).not.toThrow();
    expect(() => assertSubscriptionTransition('ACTIVE', 'EXPIRED')).not.toThrow();
    expect(() => assertSubscriptionTransition('EXPIRED', 'ACTIVE')).toThrowError(
      'Cannot transition EXPIRED to ACTIVE',
    );
    expect(() => assertSubscriptionTransition('CANCELED', 'PAST_DUE')).toThrow();
  });
});
