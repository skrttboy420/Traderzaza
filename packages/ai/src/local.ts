import type { Locale, Setup } from "@atc/types";
import { renderPhrase, renderPhrases } from "@atc/engine";
import type { AiAnalysis } from "./schema";
import type {
  AiProvider,
  AiProviderResult,
  AnalyzeRequest,
  ChatRequest,
} from "./provider";
import { DISCLAIMER } from "./provider";

/**
 * Deterministic explainer.
 *
 * Used when no LLM key is configured, and as the fallback whenever the LLM
 * returns output that fails validation. It only restates engine output, so it
 * can never hallucinate a level — which is why it is safe as a default.
 *
 * This file used to carry a second, hand-written Thai narrative (`thaiFacts`,
 * `thaiWhyEnter`, and friends) that reworded the engine's English. Two parallel
 * narratives meant two things to keep in sync, and the Thai one only reached
 * the AI panel — every screen reading `setup.whyEnter` directly still showed
 * English. Now the engine emits `Phrase` keys and this layer just renders them,
 * so there is exactly one narrative and it exists in both languages.
 */
export class LocalExplainer implements AiProvider {
  readonly name = "deterministic";
  readonly available = true;

  async analyze(request: AnalyzeRequest): Promise<AiProviderResult> {
    return {
      analysis: buildLocalAnalysis(request.setup, request.locale),
      source: "deterministic",
      note:
        request.locale === "th"
          ? "คำอธิบายนี้สร้างจากผลคำนวณของเอนจินโดยตรง ไม่ได้ผ่านโมเดลภาษา"
          : "This explanation is generated directly from engine output, without a language model.",
    };
  }

  async chat(request: ChatRequest): Promise<{ content: string; source: "deterministic" }> {
    const last = request.messages[request.messages.length - 1]?.content ?? "";
    return { content: answerFromFacts(last, request.setup, request.locale), source: "deterministic" };
  }
}

export function buildLocalAnalysis(setup: Setup, locale: Locale): AiAnalysis {
  const plan = setup.plans.find((candidate) => candidate.name === "Balanced") ?? setup.plans[0];

  return {
    asset: setup.symbol,
    timeframe: setup.timeframe,
    market_regime: setup.regime,
    direction: setup.direction,
    setup_status: setup.status,
    setup_quality: setup.quality.score,
    ai_confidence: setup.aiConfidence,
    entry_zone: plan ? { low: plan.entryZone.low, high: plan.entryZone.high } : { low: 0, high: 0 },
    confirmation_required: renderPhrases(setup.confirmationRequired, locale),
    stop_loss: plan?.stopLoss ?? 0,
    take_profit: plan?.takeProfits.map((t) => t.price) ?? [],
    risk_reward: plan?.riskReward ?? 0,
    why_enter: renderPhrases(setup.whyEnter, locale),
    why_wait: renderPhrases(setup.whyWait, locale),
    invalidation: renderPhrases(setup.invalidation, locale),
    facts: renderPhrases(setup.facts, locale),
    interpretation: renderPhrases(setup.interpretation, locale),
    assumptions: renderPhrases(setup.assumptions, locale),
  };
}

/**
 * Fact-grounded answer for the no-LLM path. It never speculates: if the
 * question is not covered by engine output, it says so.
 */
function answerFromFacts(question: string, setup: Setup | null, locale: Locale): string {
  const th = locale === "th";
  if (!setup) {
    return th
      ? `ยังไม่มีเซ็ตอัพที่เลือกอยู่ เลยตอบจากกราฟจริงไม่ได้ ลองเลือกเซ็ตอัพจากหน้า Setups ก่อนนะ\n\n${DISCLAIMER.th}`
      : `No setup is selected, so there is no chart to answer from. Pick a setup first.\n\n${DISCLAIMER.en}`;
  }

  const q = question.toLowerCase();
  const sections: string[] = [];
  const bullets = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");

  const wantsEntry = /entry|เข้า|จุดเข้า|buy|sell/.test(q);
  const wantsStop = /stop|sl|ตัดขาดทุน|คัทลอส/.test(q);
  const wantsTarget = /target|tp|เป้า|take profit/.test(q);
  const wantsWhy = /why|ทำไม|เพราะ/.test(q);
  const anything = wantsEntry || wantsStop || wantsTarget || wantsWhy;

  const plan = setup.plans.find((candidate) => candidate.name === "Balanced") ?? setup.plans[0];

  sections.push(
    `${th ? "**ข้อเท็จจริง (FACT)**" : "**FACTS**"}\n${bullets(renderPhrases(setup.facts, locale))}`,
  );

  if ((wantsEntry || wantsStop || wantsTarget || !anything) && plan) {
    const stopReason = renderPhrase(plan.stopLossReason, locale);
    const lines = [
      th
        ? `โซนเข้า: ${plan.entryZone.low} - ${plan.entryZone.high} (ราคาดีที่สุด ${plan.bestPrice} / ราคาปลอดภัยกว่า ${plan.saferPrice})`
        : `Entry zone: ${plan.entryZone.low} - ${plan.entryZone.high} (best ${plan.bestPrice} / safer ${plan.saferPrice})`,
      `${th ? "SL" : "Stop"}: ${plan.stopLoss} — ${stopReason}`,
      ...plan.takeProfits.map(
        (t) => `${t.label}: ${t.price} (R:R ${t.rr}) — ${renderPhrase(t.reason, locale)}`,
      ),
    ];
    sections.push(`${th ? "**แผนเข้า**" : "**PLAN**"}\n${bullets(lines)}`);
  }

  sections.push(
    `${th ? "**การตีความ (INTERPRETATION)**" : "**INTERPRETATION**"}\n${bullets(
      renderPhrases(setup.interpretation, locale),
    )}`,
  );

  sections.push(
    `${th ? "**สมมติฐาน (ASSUMPTION)**" : "**ASSUMPTIONS**"}\n${bullets(
      renderPhrases(setup.assumptions, locale),
    )}`,
  );

  sections.push(
    th
      ? "_หมายเหตุ: คำตอบนี้มาจากตัวคำนวณของระบบโดยตรง (ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY) จึงตอบได้เฉพาะสิ่งที่เอนจินคำนวณไว้แล้ว_"
      : "_Note: this answer comes straight from the engine (no ANTHROPIC_API_KEY configured), so it only covers what the engine calculated._",
  );
  sections.push(th ? DISCLAIMER.th : DISCLAIMER.en);

  return sections.join("\n\n");
}
