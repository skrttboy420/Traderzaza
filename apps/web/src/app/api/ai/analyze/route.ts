import { NextResponse } from "next/server";
import { createAiProvider, guardLanguage } from "@atc/ai";
import { getAsset } from "@atc/market-data";
import type { ExplanationLevel, Locale, Timeframe } from "@atc/types";

import { analyzeSymbol } from "@/lib/scan";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
// One LLM call plus the deterministic analysis behind it. Claude streaming is
// not used here, so the whole answer has to arrive inside one invocation.
export const maxDuration = 60;

interface Body {
  symbol?: string;
  timeframe?: Timeframe;
  setupId?: string;
  locale?: Locale;
  level?: ExplanationLevel;
  mode?: "coach" | "direct";
}

/**
 * POST /api/ai/analyze
 *
 * Runs the deterministic engine first, then asks the AI layer to explain the
 * chosen setup. The response always carries `source` so the UI can tell the
 * user whether a language model wrote the prose or the engine did (§70-71).
 *
 * The API key lives only in this process (§77).
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.toUpperCase();
  if (!symbol || !getAsset(symbol)) {
    return NextResponse.json({ error: "valid symbol is required" }, { status: 400 });
  }

  const locale: Locale = body.locale === "en" ? "en" : "th";
  const level: ExplanationLevel = body.level ?? "intermediate";
  const mode = body.mode === "direct" ? "direct" : "coach";

  try {
    const { result } = await analyzeSymbol(symbol, { entryTimeframe: body.timeframe ?? "15m" });

    const setup =
      (body.setupId ? result.setups.find((s) => s.id === body.setupId) : undefined) ??
      result.best ??
      result.setups[0];

    if (!setup) {
      return NextResponse.json(
        { error: "no setup available for this market", noTradeReasons: result.noTradeReasons },
        { status: 404 },
      );
    }

    const env = serverEnv();
    const provider = createAiProvider({
      ...(env.anthropicApiKey ? { ANTHROPIC_API_KEY: env.anthropicApiKey } : {}),
      ...(env.anthropicModel ? { ANTHROPIC_MODEL: env.anthropicModel } : {}),
    });

    const ai = await provider.analyze({ setup, locale, level, mode });

    // §83: a last line of defence against forbidden language, even from our own
    // deterministic text. If it trips, we say so rather than shipping it.
    const guard = guardLanguage(ai.analysis);

    return NextResponse.json({
      analysis: ai.analysis,
      source: ai.source,
      note: ai.note ?? null,
      provider: provider.name,
      setupId: setup.id,
      dataStatus: result.dataStatus,
      languageGuard: guard,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ai analysis failed" },
      { status: 502 },
    );
  }
}
