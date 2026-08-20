export type AiMessageInput = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string };
export type AiToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };
export type AiToolCall = { id: string; name: string; arguments: unknown };
export type AiResult = { answer: string; toolCalls: AiToolCall[]; usage: { inputTokens: number; outputTokens: number; neurons: number } };
export interface AiProvider {
  readonly name: string;
  complete(messages: AiMessageInput[], tools?: AiToolDefinition[]): Promise<AiResult>;
  health(): Promise<boolean>;
}
