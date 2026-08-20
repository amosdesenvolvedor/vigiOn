import { env } from '../../config/env';
import type { AiMessageInput, AiProvider, AiResult, AiToolDefinition } from './ai-provider';

type CfResponse = { success?: boolean; errors?: Array<{ code?: number; message?: string }>; result?: Record<string, unknown> };
export class AiProviderError extends Error {
  constructor(readonly code: 'TIMEOUT' | 'QUOTA' | 'UNAVAILABLE' | 'INVALID_RESPONSE') { super(code); }
}

export class CloudflareWorkersAiProvider implements AiProvider {
  readonly name = 'cloudflare';
  private failures = 0;
  private openedAt = 0;

  async complete(messages: AiMessageInput[], tools: AiToolDefinition[] = []): Promise<AiResult> {
    if (this.failures >= env.AI_CIRCUIT_FAILURE_THRESHOLD && Date.now() - this.openedAt < env.AI_CIRCUIT_RESET_MS)
      throw new AiProviderError('UNAVAILABLE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${env.AI_MODEL}`, {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messages, ...(tools.length ? { tools } : {}), max_tokens: env.AI_MAX_OUTPUT_TOKENS, temperature: 0.15 }),
      });
      const body = (await response.json().catch(() => null)) as CfResponse | null;
      if (response.status === 429 || body?.errors?.some(({ code }) => code === 3036)) throw new AiProviderError('QUOTA');
      if (!response.ok || !body?.success || !body.result) throw new AiProviderError('UNAVAILABLE');
      this.failures = 0;
      const result = body.result;
      const choice = (result.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      const rawCalls = (message?.tool_calls ?? result.tool_calls ?? []) as Array<Record<string, unknown>>;
      const toolCalls = rawCalls.map((call, index) => {
        const fn = (call.function ?? call) as Record<string, unknown>;
        let args: unknown = fn.arguments ?? {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        return { id: String(call.id ?? `tool-${index}`), name: String(fn.name ?? ''), arguments: args };
      }).filter(({ name }) => name);
      const usage = (result.usage ?? {}) as Record<string, unknown>;
      return {
        answer: typeof message?.content === 'string' ? message.content : typeof result.response === 'string' ? result.response : '',
        toolCalls,
        usage: { inputTokens: Number(usage.prompt_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0), neurons: Number(usage.neurons ?? 0) },
      };
    } catch (error) {
      if (error instanceof AiProviderError) { if (error.code !== 'QUOTA') { this.failures++; this.openedAt = Date.now(); } throw error; }
      this.failures++; this.openedAt = Date.now();
      throw new AiProviderError(error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }

  async health() {
    return Boolean(env.AI_ENABLED && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_API_TOKEN && (this.failures < env.AI_CIRCUIT_FAILURE_THRESHOLD || Date.now() - this.openedAt >= env.AI_CIRCUIT_RESET_MS));
  }
}
