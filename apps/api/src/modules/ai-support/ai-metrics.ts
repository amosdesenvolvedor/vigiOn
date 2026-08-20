const state = { requests: 0, failures: 0, timeouts: 0, quotaRejections: 0, totalLatencyMs: 0, completed: 0 };
export const aiMetrics = {
  requested: () => { state.requests++; },
  completed: (durationMs: number) => { state.completed++; state.totalLatencyMs += durationMs; },
  failed: (code?: string) => { state.failures++; if (code === 'TIMEOUT') state.timeouts++; if (code === 'QUOTA') state.quotaRejections++; },
  snapshot: () => ({ ai_requests_total: state.requests, ai_requests_today: state.requests, ai_failures_total: state.failures, ai_provider_timeouts: state.timeouts, ai_quota_rejections: state.quotaRejections, ai_average_latency: state.completed ? Math.round(state.totalLatencyMs / state.completed) : 0 }),
};
