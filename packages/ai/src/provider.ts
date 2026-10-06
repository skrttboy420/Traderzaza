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

export interface ChatRequest {
  messages: ChatMessage[];
  locale: Locale;
  level: ExplanationLevel;
  mode: CoachMode;
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

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  analyze(request: AnalyzeRequest): Promise<AiProviderResult>;
  chat(request: ChatRequest): Promise<{ content: string; source: "llm" | "deterministic" }>;
}

export const DISCLAIMER = {
  en: "This is an educational and analytical tool, not financial advice. You make the final decision on every trade.",
  th: "เครื่องมือนี้ใช้เพื่อการศึกษาและวิเคราะห์ ไม่ใช่คำแนะนำการลงทุน การตัดสินใจสุดท้ายเป็นของคุณเสมอ",
} as const;
