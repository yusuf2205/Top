/**
 * Queue name registry — single source of truth so apps/api (producer) and
 * apps/worker (consumer) never drift on a string literal.
 *
 * Only the queue name is defined in M0. Job payload types and the actual
 * processors (extract-quote, email, document-generation — see
 * INFRASTRUCTURE.md §STEP9 AI Architecture) are added starting M4, alongside
 * the feature that needs them.
 */
export const QUEUE_NAMES = {
  QUOTE_EXTRACTION: "quote-extraction",
  EMAIL: "email",
  DOCUMENT_GENERATION: "document-generation",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
