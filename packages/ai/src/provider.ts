import type { ExplanationLevel, Locale, Setup, Trade } from "@atc/types";
import type { AiAnalysis } from "./schema";

export type CoachMode = "coach" | "direct";

export interface AnalyzeRequest {
  setup: Setup;
  locale: Locale;
  level: ExplanationLevel;
  mode: CoachMode;
  /** Extra deterministic facts from the engine the model may quote verbatim. */
  extraFacts?: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * What the trader asked for, which decides how long the answer is allowed to be
 * and whether coach mode applies.
 *
 * All four arrive through `chat()` because they all need the same grounding —
 * the real setup on screen — but they are not the same kind of answer. `chat`
 * is a question at the desk and wants four sentences; `teach` is a deliberate
 * walkthrough the trader opened on purpose and wants all seven steps. Treating
 * them identically meant one of the two was always wrong.
 */
export type ChatIntent = "chat" | "teach" | "whatif" | "grade";

export interface ChatRequest {
  messages: ChatMessage[];
  locale: Locale;
  level: ExplanationLevel;
  mode: CoachMode;
  /** Defaults to "chat" — the shortest budget, which is the safe default. */
  intent?: ChatIntent;
  /** The setup currently on screen, so answers are about the real chart. */
  setup: Setup | null;
  /** Journal evidence. Behaviour claims are only allowed when this is present. */
  trades?: Trade[];
}

export interface AiProviderResult {
  analysis: AiAnalysis;
  /** Which layer produced this, so the UI can be honest about it. */
  source: "llm" | "deterministic";
  note?: string;
}

export interface ChatResult {
  content: string;
  source: "llm" | "deterministic";
  /**
   * Why the model did not answer, when a key *was* configured.
   *
   * Without this, the two reasons a chat answer comes back deterministic are
   * indistinguishable on screen: no key set, versus a key that is set and
   * failing. They need very different fixes — and the second is the likely one
   * right after someone pastes a key, because a mistyped key, a model name the
   * account cannot reach and an exhausted credit balance all land here. The
   * answer is still correct either way; what was missing was any way to find
   * out that the model never ran.
   */
  note?: string;
}

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  analyze(request: AnalyzeRequest): Promise<AiProviderResult>;
  chat(request: ChatRequest): Promise<ChatResult>;
}

export const DISCLAIMER = {
  en: "This is an educational and analytical tool, not financial advice. You make the final decision on every trade.",
  th: "เครื่องมือนี้ใช้เพื่อการศึกษาและวิเคราะห์ ไม่ใช่คำแนะนำการลงทุน การตัดสินใจสุดท้ายเป็นของคุณเสมอ",
} as const;
