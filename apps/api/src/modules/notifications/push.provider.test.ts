import { describe, expect, it } from 'vitest';
import { safePath } from './push.provider';

describe('push deep links', () => {
  it('accepts internal allowlisted paths and blocks external redirects', () => {
    expect(safePath('/alerts?alert=abc')).toBe('/alerts?alert=abc');
    expect(safePath('/events/abc')).toBe('/events/abc');
    expect(safePath('https://evil.example/alerts')).toBe('/monitoring');
    expect(safePath('//evil.example')).toBe('/monitoring');
  });
});
