/**
 * AIProvider abstraction — locked in TOP Procurement — CTO Decision Lock.md §21
 * and reconfirmed in FINAL-INFRASTRUCTURE-ARCHITECTURE.md p.9.
 *
 * No business logic (apps/api modules) may import an LLM SDK directly — everything
 * goes through this interface, so swapping/adding providers (Anthropic → OpenAI →
 * Ollama/local) never touches purchase-requests/rfqs/quotes/recommendations code.
 *
 * Implementations land in M4 (extraction) / M6 (recommendation) — this package only
 * establishes the contract in M0 so downstream modules can be built against it.
 */

export interface AIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ExtractionField<T = unknown> {
  value: T;
  confidence: number; // 0..1
}

export interface ExtractionResult {
  fields: Record<string, ExtractionField>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ClassificationResult {
  label: string;
  confidence: number;
  model: string;
}

export interface AIProvider {
  chat(messages: AIChatMessage[], options?: { tools?: unknown[] }): Promise<AIResponse>;
  extract(document: { data: Buffer; mimeType: string }, schema: Record<string, unknown>): Promise<ExtractionResult>;
  classify(input: string, labels: string[]): Promise<ClassificationResult>;
}

/**
 * Structured usage-log entry — the MVP's AI cost tracking (structured logs, not a
 * dedicated AIUsage/AIUsageLimit table yet — that is Phase 2). Field set is locked,
 * see FINAL-INFRASTRUCTURE-ARCHITECTURE.md "AI cost logging".
 */
export interface AIUsageLogEntry {
  organizationId: string;
  userId: string;
  operation: string;
  provider: string;
  model: string;
  inputHash: string;
  tokens: { input: number; output: number };
  estimatedCost: number;
  timestamp: string;
}
