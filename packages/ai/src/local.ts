import type { Locale, Setup } from "@atc/types";
import { directionPhrase, renderPhrase, renderPhrases, statusPhrase } from "@atc/engine";
import type { AiAnalysis } from "./schema";
import type {
  AiProvider,
  AiProviderResult,
  AnalyzeRequest,
  ChatRequest,
} from "./provider";

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
 *
 * It also has to be short, because the Coach should read roughly the same way
 * whether or not a key is configured. Having no model is a real constraint on
 * how it gets there: it cannot summarise, so the only lever is selection. It
 * leads with the call, prints only the part of the plan the question actually
 * asked about, and caps each block.
 *
 * The previous version printed every block on every question — the full fact
 * list, the whole plan, the interpretation, the assumptions and a copy of the
 * disclaimer — so asking "where is the stop" returned about twenty-five lines
 * with the answer somewhere in the middle. The cuts are padding, not substance:
 * the FACT / INTERPRETATION / ASSUMPTION labels stay, because this path quotes
 * the engine verbatim and the labels are the only thing showing that nothing in
 * it was reworded. The disclaimer goes because every screen that can display
 * this already prints it once (`<Disclaimer>`), and repeating it under each
 * answer is exactly the noise the brevity rules exist to remove.
 */
function answerFromFacts(question: string, setup: Setup | null, locale: Locale): string {
  const th = locale === "th";
  if (!setup) {
    return th
      ? "ยังไม่ได้เลือกเซ็ตอัพ เลยตอบจากกราฟจริงไม่ได้ ไปเลือกจากหน้า Setups ก่อนนะ"
      : "No setup is selected, so there is no chart to answer from. Pick one on the Setups screen first.";
  }

  const q = question.toLowerCase();
  const sections: string[] = [];
  const bullets = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");
  const block = (heading: string, lines: string[]) =>
    lines.length > 0 ? `**${heading}**\n${bullets(lines)}` : null;

  // "ทำไมยังไม่ควรเข้าตอนนี้" contains the word "เข้า", so a naive keyword
  // match answers a wait question with the entry zone — the one thing it did
  // not ask for. What disqualifies the entry match is the *negation*, not the
  // word "why": "ทำไม SL ต้องอยู่จุดนี้" is also a why question and still
  // wants the stop printed next to the reasoning.
  const negated = /ยังไม่|ไม่ควร|อย่าเพิ่ง|not yet|should ?n[o']t/.test(q);
  const asksReason = /why|ทำไม|เพราะ|\bรอ\b|wait/.test(q) || negated;
  const asksInvalidation = /invalid|ยกเลิก|เสีย|ผิดทาง|หลุด/.test(q);

  const wantsEntry = !negated && /entry|เข้า|จุดเข้า|buy|sell|ซื้อ|ขาย/.test(q);
  const wantsStop = /stop|\bsl\b|ตัดขาดทุน|คัทลอส/.test(q);
  const wantsTarget = /target|\btp\b|เป้า|take profit/.test(q);
  const wantsPlan = wantsEntry || wantsStop || wantsTarget;

  const plan = setup.plans.find((candidate) => candidate.name === "Balanced") ?? setup.plans[0];

  // Lead with the call. Whatever is below it, this is the line the trader came
  // for, and it must not be something you only reach by scrolling.
  sections.push(headline(setup, locale));

  // A reason question is answered by the engine's own reasons, not by the
  // plan. `whyWait` is why it is not a trade yet, `invalidation` is what kills
  // the idea outright — both are engine output, so neither is a guess, and
  // they are different questions that used to get the same answer.
  if (asksInvalidation) {
    const invalid = block(
      th ? "อะไรทำให้ไอเดียนี้เสีย" : "WHAT KILLS THIS IDEA",
      renderPhrases(setup.invalidation, locale).slice(0, 3),
    );
    if (invalid) sections.push(invalid);
  } else if (asksReason) {
    const waiting = block(
      th ? "ทำไมยังไม่เข้า" : "WHY NOT YET",
      renderPhrases(setup.whyWait, locale).slice(0, 3),
    );
    const entering = block(
      th ? "อะไรที่เข้าทางแล้ว" : "WHAT IS ALREADY IN ITS FAVOUR",
      renderPhrases(setup.whyEnter, locale).slice(0, 2),
    );
    if (waiting) sections.push(waiting);
    if (entering) sections.push(entering);
  }

  // The plan prints when the question named part of it, or when it named
  // nothing at all. A pure "why" question has already been answered above.
  if (plan && (wantsPlan || !(asksReason || asksInvalidation))) {
    // Naming nothing means "tell me the plan"; naming one part means answer
    // that part and leave the rest out.
    const all = !wantsPlan;
    const lines: string[] = [];
    if (all || wantsEntry) {
      lines.push(
        th
          ? `เข้าโซน ${plan.entryZone.low} - ${plan.entryZone.high} (ดีสุด ${plan.bestPrice} / ปลอดภัยกว่า ${plan.saferPrice})`
          : `Entry ${plan.entryZone.low} - ${plan.entryZone.high} (best ${plan.bestPrice} / safer ${plan.saferPrice})`,
      );
    }
    if (all || wantsStop) {
      lines.push(`${th ? "SL" : "Stop"} ${plan.stopLoss} — ${renderPhrase(plan.stopLossReason, locale)}`);
    }
    if (all || wantsTarget) {
      // One target, not the whole ladder: the first is the one that decides
      // whether the trade is worth taking at all.
      const first = plan.takeProfits[0];
      if (first) {
        lines.push(
          `${first.label} ${first.price} (R:R ${first.rr}) — ${renderPhrase(first.reason, locale)}`,
        );
      }
    }
    const planBlock = block(th ? "แผนเข้า" : "PLAN", lines);
    if (planBlock) sections.push(planBlock);
  }

  // Three / two / two. Enough to show the reasoning rests on something,
  // few enough to still be read on a phone next to a chart.
  for (const candidate of [
    block(th ? "ข้อเท็จจริง (FACT)" : "FACTS", renderPhrases(setup.facts, locale).slice(0, 3)),
    block(
      th ? "การตีความ (INTERPRETATION)" : "INTERPRETATION",
      renderPhrases(setup.interpretation, locale).slice(0, 2),
    ),
    block(
      th ? "สมมติฐาน (ASSUMPTION)" : "ASSUMPTIONS",
      renderPhrases(setup.assumptions, locale).slice(0, 2),
    ),
  ]) {
    if (candidate) sections.push(candidate);
  }

  // No "this came from the engine, not a model" footer. `source` already says
  // so in the return value, and every caller renders it as a badge above the
  // answer in the user's own language — so the footer was the same sentence
  // twice, in English-ish markdown the renderer does not even support (it has
  // no italics, so the underscores printed literally).
  return sections.join("\n\n");
}

/**
 * The call in one spoken sentence.
 *
 * Deliberately built from `statusPhrase` / `directionPhrase` rather than from
 * hand-written Thai: those keys are what every other screen renders, so the
 * Coach's first line says the same words as the badge the trader just tapped.
 * A second wording for the same state is how the two drift apart.
 */
function headline(setup: Setup, locale: Locale): string {
  const th = locale === "th";
  const status = renderPhrase(statusPhrase(setup.status), locale);
  const direction = renderPhrase(directionPhrase(setup.direction), locale);
  const quality = `${setup.quality.score}/100 (${setup.quality.grade})`;

  if (setup.direction === "none") {
    return th
      ? `ตอนนี้ ${setup.symbol} ${setup.timeframe} ยังไม่มีฝั่งที่ชัด สถานะ ${status} คุณภาพเซ็ตอัพ ${quality}`
      : `${setup.symbol} ${setup.timeframe} has no clear side right now — status ${status}, setup quality ${quality}.`;
  }
  // No "ฝั่ง" prefix here: the Thai side of `label.direction.*` already reads
  // "ฝั่ง Buy" / "ฝั่ง Sell", and adding one produced "ฝั่ง ฝั่ง Sell".
  return th
    ? `${setup.symbol} ${setup.timeframe} ${direction} สถานะ ${status} คุณภาพเซ็ตอัพ ${quality}`
    : `${setup.symbol} ${setup.timeframe} is ${direction} — status ${status}, setup quality ${quality}.`;
}
