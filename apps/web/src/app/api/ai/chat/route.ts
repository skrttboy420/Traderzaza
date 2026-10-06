import { NextResponse } from "next/server";
import {
  createAiProvider,
  gradeAnalysisPrompt,
  teachMePrompt,
  whatIfPrompt,
  type ChatMessage,
} from "@atc/ai";
import { getAsset } from "@atc/market-data";
import type { ExplanationLevel, Locale, Timeframe, Trade } from "@atc/types";

import { analyzeSymbol } from "@/lib/scan";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
// One LLM call plus the deterministic analysis behind it. Claude streaming is
// not used here, so the whole answer has to arrive inside one invocation.
export const maxDuration = 60;

type Intent = "chat" | "teach" | "whatif" | "grade";

interface Body {
  intent?: Intent;
  symbol?: string;
  timeframe?: Timeframe;
  setupId?: string;
  locale?: Locale;
  level?: ExplanationLevel;
  mode?: "coach" | "direct";
  messages?: ChatMessage[];
  /** Scenario text for whatif, or the trader's own analysis for grade. */
  input?: string;
  /** Journal entries. Behaviour claims are only permitted with this evidence (§68). */
  trades?: Trade[];
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        (( m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string",
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

/**
 * POST /api/ai/chat
 *
 * One endpoint for the four conversational features, because they all need the
 * same thing: the real setup on screen as grounding. `intent` selects the
 * prompt (free chat, Teach Me This Setup §22, What If §23, grade my own
 * analysis §37).
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const intent: Intent = body.intent ?? "chat";
  const locale: Locale = body.locale === "en" ? "en" : "th";
  const level: ExplanationLevel = body.level ?? "intermediate";
  const mode = body.mode === "direct" ? "direct" : "coach";
  const symbol = body.symbol?.toUpperCase();

  if (symbol && !getAsset(symbol)) {
    return NextResponse.json({ error: `unknown symbol: ${symbol}` }, { status: 404 });
  }

  try {
    // Ground every answer in a freshly computed setup rather than trusting
    // whatever the client sent us.
    let setup = null as Awaited<ReturnType<typeof analyzeSymbol>>["result"]["best"];
    if (symbol) {
      const { result } = await analyzeSymbol(symbol, { entryTimeframe: body.timeframe ?? "15m" });
      setup =
        (body.setupId ? result.setups.find((s) => s.id === body.setupId) : undefined) ??
        result.best ??
        result.setups[0] ??
        null;
    }

    let messages = sanitizeMessages(body.messages);

    if (intent !== "chat") {
      if (!setup) {
        return NextResponse.json(
          { error: "this feature needs a setup on screen; pass a symbol" },
          { status: 400 },
        );
      }
      const input = (body.input ?? "").slice(0, 2000);
      if (intent === "whatif" && !input.trim()) {
        return NextResponse.json({ error: "input (scenario) is required" }, { status: 400 });
      }
      if (intent === "grade" && !input.trim()) {
        return NextResponse.json({ error: "input (your analysis) is required" }, { status: 400 });
      }

      const prompt =
        intent === "teach"
          ? teachMePrompt(setup, locale, level)
          : intent === "whatif"
            ? whatIfPrompt(setup, input, locale)
            : gradeAnalysisPrompt(setup, input, locale);

      messages = [{ role: "user", content: prompt }];
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: "messages is required" }, { status: 400 });
    }

    const env = serverEnv();
    const provider = createAiProvider({
      ...(env.anthropicApiKey ? { ANTHROPIC_API_KEY: env.anthropicApiKey } : {}),
      ...(env.anthropicModel ? { ANTHROPIC_MODEL: env.anthropicModel } : {}),
    });

    const reply = await provider.chat({
      messages,
      locale,
      level,
      mode,
      setup,
      ...(Array.isArray(body.trades) ? { trades: body.trades.slice(0, 200) } : {}),
    });

    return NextResponse.json({
      content: reply.content,
      source: reply.source,
      provider: provider.name,
      intent,
      setupId: setup?.id ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ai chat failed" },
      { status: 502 },
    );
  }
}
