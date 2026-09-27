import { createGateway } from "ai";

/**
 * Self-hosted AI Gateway (OpenAI/Anthropic/Google compatible, v3 protocol).
 * Model ids are namespaced, e.g. "anthropic/claude-sonnet-4.6",
 * "google/gemini-3.1-pro-preview".
 */
export const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

export const MODELS = {
  /** Fast, cheap text reasoning. */
  text: "anthropic/claude-sonnet-4.6",
  /** Vision — "sees" a website screenshot for colors + logo. */
  vision: "google/gemini-3.1-pro-preview",
  /** Deep reasoning — ICP-expert qualifying chat, high-stakes generation. */
  reasoning: "anthropic/claude-opus-4.6",
} as const;
