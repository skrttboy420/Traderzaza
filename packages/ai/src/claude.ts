import type { AiProvider, AiProviderResult, AnalyzeRequest, ChatRequest } from "./provider";
import { LocalExplainer, buildLocalAnalysis } from "./local";
import { SYSTEM_PROMPT, analysisUserPrompt, chatSystemPrompt } from "./prompt";
import { parseAiAnalysis, reconcileWithEngine } from "./schema";

export interface ClaudeConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

/**
 * Claude provider. The LLM only writes prose: every number is overwritten with
 * the engine's value after parsing, and invalid output falls back to the
 * deterministic explainer rather than reaching the UI.
 *
 * Swapping to another LLM means implementing AiProvider — nothing else changes.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = "claude";
  readonly available: boolean;
  private readonly config: Required<ClaudeConfig>;
  private readonly fallback = new LocalExplainer();

  constructor(config: ClaudeConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "claude-sonnet-4-6",
      maxTokens: config.maxTokens ?? 3000,
      baseUrl: (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, ""),
    };
    this.available = config.apiKey.length > 0;
  }

  async analyze(request: AnalyzeRequest): Promise<AiProviderResult> {
    if (!this.available) return this.fallback.analyze(request);

    try {
      const text = await this.call(
        SYSTEM_PROMPT,
        [{ role: "user", content: analysisUserPrompt(request) }],
      );
      const parsed = parseAiAnalysis(text);
      if (!parsed.analysis) {
        return {
          analysis: buildLocalAnalysis(request.setup, request.locale),
          source: "deterministic",
          note: `Model output was rejected (${parsed.error}). Showing engine-generated explanation instead.`,
        };
      }
      return {
        analysis: reconcileWithEngine(parsed.analysis, request.setup, request.locale),
        source: "llm",
      };
    } catch (error) {
      return {
        analysis: buildLocalAnalysis(request.setup, request.locale),
        source: "deterministic",
        note: `Claude request failed (${error instanceof Error ? error.message : "unknown error"}). Showing engine-generated explanation instead.`,
      };
    }
  }

  async chat(request: ChatRequest): Promise<{ content: string; source: "llm" | "deterministic" }> {
    if (!this.available) return this.fallback.chat(request);
    try {
      const content = await this.call(
        chatSystemPrompt(request),
        request.messages.map((m) => ({ role: m.role, content: m.content })),
      );
      return { content, source: "llm" };
    } catch {
      return this.fallback.chat(request);
    }
  }

  /** Raw prose call, used by Teach Me / What If / grading. */
  async complete(system: string, prompt: string): Promise<string> {
    return this.call(system, [{ role: "user", content: prompt }]);
  }

  private async call(
    system: string,
    messages: { role: "user" | "assistant"; content: string }[],
  ): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system,
        messages,
      }),
    });

    const payload = (await response.json()) as MessagesResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();

    if (!text) throw new Error("empty response from model");
    return text;
  }
}

/** Server-side factory. The key is read from the environment and never shipped to the client. */
export function createAiProvider(env: { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string }): AiProvider {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return new LocalExplainer();
  const config: ClaudeConfig = { apiKey: key };
  if (env.ANTHROPIC_MODEL) config.model = env.ANTHROPIC_MODEL;
  return new ClaudeProvider(config);
}
