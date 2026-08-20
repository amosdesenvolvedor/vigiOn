const blocked = /password|secret|token|credential|authorization|jwt|totp|recovery|api.?key|webhook|encryption|rtsp.?url/i;

export const sanitizeText = (value: string, maximum = 10_000) =>
  value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(?:sk|pk|whsec|cfat)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .slice(0, maximum);

export const sanitizeForAi = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeForAi);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !blocked.test(key))
        .map(([key, entry]) => [key, sanitizeForAi(entry)]),
    );
  return value;
};
